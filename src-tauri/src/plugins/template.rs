//! `{name}` placeholders for URLs and series ids.
//!
//! - `{name}` is replaced by a value from the lookup; `{name:lower}` and `{name:upper}` change case.
//! - `{today}`, `{today-365d}` and `{today-30d:%m/%d/%Y}` are dates, optionally offset and formatted.

use chrono::{DateTime, Duration, Utc};

/// The placeholder names used in `template`, without filters.
pub fn placeholders(template: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        let Some(end) = rest[start..].find('}') else {
            break;
        };
        let inner = &rest[start + 1..start + end];
        names.push(inner.split(':').next().unwrap_or(inner).to_string());
        rest = &rest[start + end + 1..];
    }
    names
}

/// True for `today` and `today-Nd`.
pub fn is_date_expression(name: &str) -> bool {
    parse_date_expression(name).is_some()
}

fn parse_date_expression(name: &str) -> Option<i64> {
    let rest = name.strip_prefix("today")?;
    if rest.is_empty() {
        return Some(0);
    }
    let days = rest
        .strip_prefix('-')?
        .strip_suffix('d')?
        .parse::<i64>()
        .ok()?;
    (0..=3650).contains(&days).then_some(days)
}

pub fn render(
    template: &str,
    now: DateTime<Utc>,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let end = rest[start..]
            .find('}')
            .ok_or_else(|| format!("unclosed '{{' in \"{template}\""))?;
        let inner = &rest[start + 1..start + end];
        let (name, filter) = inner
            .split_once(':')
            .map_or((inner, None), |(a, b)| (a, Some(b)));
        let value = if let Some(days) = parse_date_expression(name) {
            let date = (now - Duration::days(days)).date_naive();
            date.format(filter.unwrap_or("%Y-%m-%d")).to_string()
        } else {
            let value = lookup(name).ok_or_else(|| format!("no value for {{{name}}}"))?;
            match filter {
                None => value,
                Some("lower") => value.to_lowercase(),
                Some("upper") => value.to_uppercase(),
                Some(other) => return Err(format!("unknown filter \"{other}\" on {{{name}}}")),
            }
        };
        out.push_str(&value);
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-24T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn substitutes_values_filters_and_dates() {
        let lookup = |name: &str| (name == "state").then(|| "IA".to_string());
        assert_eq!(
            render("drought.{state:lower}.D0", now(), &lookup).unwrap(),
            "drought.ia.D0"
        );
        assert_eq!(render("{state:upper}", now(), &lookup).unwrap(), "IA");
        assert_eq!(render("{today}", now(), &lookup).unwrap(), "2026-10-24");
        assert_eq!(
            render("{today-30d:%-m/%-d/%Y}", now(), &lookup).unwrap(),
            "9/24/2026"
        );
    }

    #[test]
    fn reports_missing_values_and_bad_syntax() {
        let none = |_: &str| None;
        assert!(
            render("{x}", now(), &none)
                .unwrap_err()
                .contains("no value for {x}")
        );
        assert!(render("{x", now(), &none).unwrap_err().contains("unclosed"));
        assert!(
            render("{x:shout}", now(), &|_: &str| Some("a".into()))
                .unwrap_err()
                .contains("unknown filter")
        );
    }

    #[test]
    fn lists_placeholder_names() {
        assert_eq!(
            placeholders("a{b}c{d:lower}{today-5d:%Y}"),
            vec!["b", "d", "today-5d"]
        );
        assert!(is_date_expression("today-365d"));
        assert!(!is_date_expression("today-x"));
        assert!(!is_date_expression("todayish"));
    }
}
