//! Physical-record checks. The relay never inspects business field names.

use serde_json::Value;

/// Physical record cap matching `MAX_WIRE_RECORD_BYTES` in the process carrier.
pub const MAX_WIRE_RECORD_BYTES: usize = 256 * 1024;

/// Why a physical line cannot be forwarded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordViolation {
    /// Line length exceeds [`MAX_WIRE_RECORD_BYTES`].
    Oversize,
    /// Line is not a JSON value.
    InvalidJson,
}

impl RecordViolation {
    /// Stable close reason forwarded to the WebView or harness.
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::Oversize => "record-too-large",
            Self::InvalidJson => "invalid-json",
        }
    }
}

/**
 * Accept one physical line or name the violation that closes the relay.
 *
 * @param line - bytes between newlines, without the terminator.
 */
pub fn validate_physical_line(line: &str) -> Result<(), RecordViolation> {
    if line.len() > MAX_WIRE_RECORD_BYTES {
        return Err(RecordViolation::Oversize);
    }
    serde_json::from_str::<Value>(line).map(|_| ()).map_err(|_| RecordViolation::InvalidJson)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_a_line_above_the_physical_record_limit() {
        let line = format!("\"{}\"", "x".repeat(MAX_WIRE_RECORD_BYTES));
        assert!(line.len() > MAX_WIRE_RECORD_BYTES);
        let error = validate_physical_line(&line).expect_err("oversize line");
        assert_eq!(error, RecordViolation::Oversize);
        assert_eq!(error.reason(), "record-too-large");
    }

    #[test]
    fn refuses_a_non_json_line() {
        let error = validate_physical_line("not-json").expect_err("non-json line");
        assert_eq!(error, RecordViolation::InvalidJson);
        assert_eq!(error.reason(), "invalid-json");
    }

    #[test]
    fn accepts_a_json_value_without_reading_field_names() {
        assert!(validate_physical_line(r#"{"type":"control/hello"}"#).is_ok());
        assert!(validate_physical_line("[]").is_ok());
        assert!(validate_physical_line("0").is_ok());
    }
}
