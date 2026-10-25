//! Declarative data-source plugins: a TOML manifest describes one HTTP request and how to map
//! the response onto observations. Plugins never run code; they are data run by the app's own
//! connector, and every network request goes through one permission-enforcing client.

pub mod http;
pub mod manifest;
pub mod registry;
pub mod source;
pub mod template;
