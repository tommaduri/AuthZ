//! Value conversion between serde_json::Value and cel_interpreter types

use cel_interpreter::objects::Value as CelValue;
use serde_json::Value as JsonValue;

/// Convert serde_json::Value to cel_interpreter::Value
pub fn json_to_cel(value: &JsonValue) -> CelValue {
    match value {
        JsonValue::Null => CelValue::Null,
        JsonValue::Bool(b) => CelValue::Bool(*b),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                CelValue::Int(i)
            } else if let Some(u) = n.as_u64() {
                CelValue::UInt(u)
            } else if let Some(f) = n.as_f64() {
                CelValue::Float(f)
            } else {
                CelValue::Null
            }
        }
        JsonValue::String(s) => CelValue::String(s.clone().into()),
        JsonValue::Array(arr) => {
            let cel_vec: Vec<CelValue> = arr.iter().map(json_to_cel).collect();
            CelValue::List(cel_vec.into())
        }
        JsonValue::Object(obj) => {
            // Convert object to CEL Map
            // The Map type in cel-interpreter uses Arc<HashMap<Key, Value>> internally
            use std::collections::HashMap;
            use std::sync::Arc;
            use cel_interpreter::objects::{Key, Map};

            let mut map_data: HashMap<Key, CelValue> = HashMap::new();
            for (k, v) in obj.iter() {
                map_data.insert(Key::from(k.clone()), json_to_cel(v));
            }
            CelValue::Map(Map { map: Arc::new(map_data) })
        }
    }
}

/// Convert cel_interpreter::Value to serde_json::Value
pub fn cel_to_json(value: &CelValue) -> JsonValue {
    match value {
        CelValue::Null => JsonValue::Null,
        CelValue::Bool(b) => JsonValue::Bool(*b),
        CelValue::Int(i) => JsonValue::Number((*i).into()),
        CelValue::UInt(u) => JsonValue::Number((*u).into()),
        CelValue::Float(f) => {
            if let Some(n) = serde_json::Number::from_f64(*f) {
                JsonValue::Number(n)
            } else {
                JsonValue::Null
            }
        }
        CelValue::String(s) => JsonValue::String(s.to_string()),
        CelValue::Bytes(b) => {
            // Convert bytes to base64 string
            JsonValue::String(base64::encode(b.as_ref()))
        }
        CelValue::List(list) => {
            let json_vec: Vec<JsonValue> = list.iter().map(cel_to_json).collect();
            JsonValue::Array(json_vec)
        }
        CelValue::Map(map) => {
            let mut json_obj = serde_json::Map::new();
            // Access the inner HashMap via the Arc
            for (k, v) in map.map.as_ref().iter() {
                // Keys in CEL maps - convert to strings for JSON
                use cel_interpreter::objects::Key;
                let key_str = match k {
                    Key::String(s) => s.to_string(),
                    Key::Int(i) => i.to_string(),
                    Key::Uint(u) => u.to_string(),
                    Key::Bool(b) => b.to_string(),
                };
                json_obj.insert(key_str, cel_to_json(v));
            }
            JsonValue::Object(json_obj)
        }
        CelValue::Duration(_) | CelValue::Timestamp(_) | CelValue::Function(_, _) => {
            // For unsupported types, return string representation
            JsonValue::String(format!("{:?}", value))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_json_to_cel_bool() {
        let json = json!(true);
        let cel = json_to_cel(&json);
        assert!(matches!(cel, CelValue::Bool(true)));
    }

    #[test]
    fn test_json_to_cel_int() {
        let json = json!(42);
        let cel = json_to_cel(&json);
        assert!(matches!(cel, CelValue::Int(42)));
    }

    #[test]
    fn test_json_to_cel_string() {
        let json = json!("hello");
        let cel = json_to_cel(&json);
        if let CelValue::String(s) = cel {
            assert_eq!(s.as_ref(), "hello");
        } else {
            panic!("Expected String");
        }
    }

    #[test]
    fn test_json_to_cel_array() {
        let json = json!([1, 2, 3]);
        let cel = json_to_cel(&json);
        if let CelValue::List(list) = cel {
            assert_eq!(list.len(), 3);
        } else {
            panic!("Expected List");
        }
    }

    #[test]
    fn test_json_to_cel_object() {
        let json = json!({"key": "value"});
        let cel = json_to_cel(&json);
        if let CelValue::Map(map) = cel {
            assert_eq!(map.map.len(), 1);
        } else {
            panic!("Expected Map");
        }
    }

    #[test]
    fn test_cel_to_json_bool() {
        let cel = CelValue::Bool(true);
        let json = cel_to_json(&cel);
        assert_eq!(json, json!(true));
    }

    #[test]
    fn test_cel_to_json_int() {
        let cel = CelValue::Int(42);
        let json = cel_to_json(&cel);
        assert_eq!(json, json!(42));
    }
}
