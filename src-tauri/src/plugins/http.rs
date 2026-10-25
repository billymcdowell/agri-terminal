//! The only way a plugin reaches the network. Every request, including each redirect hop,
//! passes the same host check here, so a plugin cannot reach a host its manifest did not list.

use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, LOCATION, RETRY_AFTER};
use url::Url;

use super::manifest::host_is_listed;
use crate::core::SourceError;

const MAX_REDIRECTS: usize = 3;
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Debug)]
pub struct HostPolicy {
    hosts: Vec<String>,
    /// Lets tests talk to a local server over plain HTTP. The host allow-list still applies.
    #[cfg(test)]
    loopback_for_tests: bool,
}

impl HostPolicy {
    pub fn new(hosts: &[String]) -> Self {
        Self {
            hosts: hosts.iter().map(|host| host.to_lowercase()).collect(),
            #[cfg(test)]
            loopback_for_tests: false,
        }
    }

    #[cfg(test)]
    fn loopback(hosts: &[&str]) -> Self {
        Self {
            hosts: hosts.iter().map(|host| host.to_string()).collect(),
            loopback_for_tests: true,
        }
    }

    fn relaxed(&self) -> bool {
        #[cfg(test)]
        {
            self.loopback_for_tests
        }
        #[cfg(not(test))]
        {
            false
        }
    }

    /// Accepts only https URLs on a listed host: no credentials, no custom port, and no IP
    /// address or local name even if listed.
    pub fn check(&self, url: &Url) -> Result<(), String> {
        if !self.relaxed() {
            if url.scheme() != "https" {
                return Err(format!("only https is allowed (got {})", url.scheme()));
            }
            if url.port().is_some() {
                return Err("custom ports are not allowed".into());
            }
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err("URLs with credentials are not allowed".into());
        }
        let host = url.host_str().ok_or("URL has no host")?.to_lowercase();
        if !self.relaxed() {
            let local = host == "localhost"
                || host.ends_with(".localhost")
                || host.ends_with(".local")
                || host.ends_with(".internal");
            if local || !matches!(url.host(), Some(url::Host::Domain(_))) {
                return Err(format!(
                    "{host} is a local or IP address and cannot be contacted"
                ));
            }
        }
        if !host_is_listed(&host, &self.hosts) {
            return Err(format!("{host} is not in the plugin's permitted hosts"));
        }
        Ok(())
    }
}

pub struct Limits {
    pub max_bytes: usize,
    pub timeout: Duration,
}

fn blocked(reason: String) -> SourceError {
    SourceError::Unavailable(format!("Blocked by plugin permissions: {reason}"))
}

/// GETs `url`, following at most three redirects and re-checking the policy on each hop.
/// The body is read in chunks and abandoned as soon as it passes `limits.max_bytes`.
pub async fn get(
    policy: &HostPolicy,
    limits: &Limits,
    url: Url,
    headers: &[(String, String)],
) -> Result<Vec<u8>, SourceError> {
    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        header_map.insert(
            HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| blocked(format!("invalid header name {name}")))?,
            HeaderValue::from_str(value)
                .map_err(|_| blocked(format!("invalid value for header {name}")))?,
        );
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(limits.timeout)
        .user_agent("AgriTerminal-plugin/0.1")
        .build()
        .map_err(|error| SourceError::Unavailable(error.without_url().to_string()))?;

    let mut current = url;
    for _hop in 0..=MAX_REDIRECTS {
        policy.check(&current).map_err(blocked)?;
        let mut response = client
            .get(current.clone())
            .headers(header_map.clone())
            .send()
            .await
            .map_err(|error| SourceError::Transient(error.without_url().to_string()))?;
        let status = response.status();
        if status.is_redirection() {
            let target = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| SourceError::Transient("Redirect without a location".into()))?;
            current = current
                .join(target)
                .map_err(|_| blocked("redirect to an invalid URL".into()))?;
            // Credentials in headers are only meant for the original request; they are not
            // forwarded to a different host.
            continue;
        }
        if !status.is_success() {
            return Err(match status.as_u16() {
                401 | 403 => SourceError::Auth,
                429 => SourceError::RateLimited {
                    retry_after: response
                        .headers()
                        .get(RETRY_AFTER)
                        .and_then(|value| value.to_str().ok())
                        .and_then(|value| value.parse::<i64>().ok())
                        .map(|seconds| chrono::Utc::now() + chrono::Duration::seconds(seconds)),
                },
                other => SourceError::Transient(format!("Provider returned HTTP {other}")),
            });
        }
        if response
            .content_length()
            .is_some_and(|length| length > limits.max_bytes as u64)
        {
            return Err(blocked(format!(
                "response is larger than the {} byte limit",
                limits.max_bytes
            )));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| SourceError::Transient(error.without_url().to_string()))?
        {
            if body.len() + chunk.len() > limits.max_bytes {
                return Err(blocked(format!(
                    "response is larger than the {} byte limit",
                    limits.max_bytes
                )));
            }
            body.extend_from_slice(&chunk);
        }
        return Ok(body);
    }
    Err(blocked("too many redirects".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }
    fn policy(hosts: &[&str]) -> HostPolicy {
        HostPolicy::new(
            &hosts
                .iter()
                .map(|host| host.to_string())
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    fn only_https_on_listed_hosts_passes() {
        let policy = policy(&["api.example.com", "*.data.org"]);
        assert!(policy.check(&url("https://api.example.com/x")).is_ok());
        assert!(policy.check(&url("https://a.data.org/x")).is_ok());
        for (bad, why) in [
            ("http://api.example.com/x", "only https"),
            (
                "https://evil.example.net/x",
                "not in the plugin's permitted hosts",
            ),
            ("https://api.example.com:8443/x", "custom ports"),
            ("https://user:pw@api.example.com/x", "credentials"),
            ("https://api.example.com@evil.example.net/x", "credentials"),
            (
                "https://api.example.com.evil.net/x",
                "not in the plugin's permitted hosts",
            ),
            ("https://data.org/x", "not in the plugin's permitted hosts"),
        ] {
            let error = policy.check(&url(bad)).unwrap_err();
            assert!(error.contains(why), "{bad}: {error}");
        }
    }

    #[test]
    fn ip_addresses_and_local_names_are_refused_even_when_listed() {
        let policy = policy(&[
            "127.0.0.1",
            "localhost",
            "*.internal",
            "169.254.169.254",
            "[::1]",
        ]);
        for bad in [
            "https://127.0.0.1/x",
            "https://localhost/x",
            "https://db.internal/x",
            "https://169.254.169.254/latest/meta-data",
            "https://[::1]/x",
            "https://2130706433/x",
        ] {
            assert!(policy.check(&url(bad)).is_err(), "{bad} should be refused");
        }
    }

    /// Serves canned HTTP responses on a loopback port, one per connection.
    async fn serve(responses: Vec<String>) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            for response in responses {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mut buffer = [0u8; 2048];
                let _ = socket.read(&mut buffer).await;
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        port
    }
    fn limits(max_bytes: usize) -> Limits {
        Limits {
            max_bytes,
            timeout: Duration::from_secs(5),
        }
    }
    fn ok(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        )
    }
    fn redirect(location: &str) -> String {
        format!(
            "HTTP/1.1 302 Found\r\nlocation: {location}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
        )
    }

    #[tokio::test]
    async fn fetches_from_a_permitted_host() {
        let port = serve(vec![ok("hello")]).await;
        let body = get(
            &HostPolicy::loopback(&["127.0.0.1"]),
            &limits(100),
            url(&format!("http://127.0.0.1:{port}/")),
            &[],
        )
        .await
        .unwrap();
        assert_eq!(body, b"hello");
    }

    #[tokio::test]
    async fn a_redirect_to_an_unlisted_host_is_blocked() {
        let target = serve(vec![ok("secret")]).await;
        let port = serve(vec![redirect(&format!("http://localhost:{target}/"))]).await;
        let error = get(
            &HostPolicy::loopback(&["127.0.0.1"]),
            &limits(100),
            url(&format!("http://127.0.0.1:{port}/")),
            &[],
        )
        .await
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("localhost is not in the plugin's permitted hosts"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn redirect_loops_stop() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut buffer = [0u8; 2048];
                let _ = socket.read(&mut buffer).await;
                let _ = socket
                    .write_all(redirect(&format!("http://127.0.0.1:{port}/")).as_bytes())
                    .await;
                let _ = socket.shutdown().await;
            }
        });
        let error = get(
            &HostPolicy::loopback(&["127.0.0.1"]),
            &limits(100),
            url(&format!("http://127.0.0.1:{port}/")),
            &[],
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("too many redirects"), "{error}");
    }

    #[tokio::test]
    async fn oversized_responses_are_cut_off() {
        // Declared size over the limit is refused before reading.
        let port = serve(vec![ok(&"x".repeat(5000))]).await;
        let error = get(
            &HostPolicy::loopback(&["127.0.0.1"]),
            &limits(1000),
            url(&format!("http://127.0.0.1:{port}/")),
            &[],
        )
        .await
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("larger than the 1000 byte limit"),
            "{error}"
        );
        // A server that lies about the length (chunked, no length) is cut off while streaming.
        let chunked = format!(
            "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n",
            5000,
            "y".repeat(5000)
        );
        let port = serve(vec![chunked]).await;
        let error = get(
            &HostPolicy::loopback(&["127.0.0.1"]),
            &limits(1000),
            url(&format!("http://127.0.0.1:{port}/")),
            &[],
        )
        .await
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("larger than the 1000 byte limit"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn a_stalled_server_times_out() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(5)).await;
        });
        let short = Limits {
            max_bytes: 100,
            timeout: Duration::from_millis(300),
        };
        let error = get(
            &HostPolicy::loopback(&["127.0.0.1"]),
            &short,
            url(&format!("http://127.0.0.1:{port}/")),
            &[],
        )
        .await
        .unwrap_err();
        assert!(matches!(error, SourceError::Transient(_)), "{error}");
    }

    #[tokio::test]
    async fn status_codes_map_to_source_errors() {
        let port = serve(vec![
            "HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".into(),
        ])
        .await;
        let error = get(
            &HostPolicy::loopback(&["127.0.0.1"]),
            &limits(100),
            url(&format!("http://127.0.0.1:{port}/")),
            &[],
        )
        .await
        .unwrap_err();
        assert!(matches!(error, SourceError::Auth));
    }
}
