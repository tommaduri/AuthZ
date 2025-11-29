//! Custom CEL functions for authorization

use serde_json::Value;
use crate::cel::error::{CelError, Result};

/// Check if a principal has a specific role
///
/// # Arguments
/// * `principal` - Principal object with roles array
/// * `role` - Role name to check
///
/// # Returns
/// `true` if principal has the role, `false` otherwise
///
/// # Example
/// ```cel
/// hasRole(principal, "admin")
/// hasRole(P, "editor")
/// ```
pub fn has_role(principal: &Value, role: &Value) -> Result<bool> {
    let principal_obj = principal.as_object()
        .ok_or_else(|| CelError::TypeConversionError("principal must be an object".to_string()))?;

    let role_str = role.as_str()
        .ok_or_else(|| CelError::TypeConversionError("role must be a string".to_string()))?;

    // Try to get roles array
    if let Some(roles) = principal_obj.get("roles") {
        if let Some(roles_arr) = roles.as_array() {
            for r in roles_arr {
                if let Some(r_str) = r.as_str() {
                    if r_str == role_str {
                        return Ok(true);
                    }
                }
            }
        }
    }

    Ok(false)
}

/// Check if a principal owns a resource
///
/// # Arguments
/// * `principal` - Principal object with id
/// * `resource` - Resource object with ownerId in attributes
///
/// # Returns
/// `true` if principal owns the resource, `false` otherwise
///
/// # Example
/// ```cel
/// isOwner(principal, resource)
/// isOwner(P, R)
/// ```
pub fn is_owner(principal: &Value, resource: &Value) -> Result<bool> {
    let principal_obj = principal.as_object()
        .ok_or_else(|| CelError::TypeConversionError("principal must be an object".to_string()))?;

    let resource_obj = resource.as_object()
        .ok_or_else(|| CelError::TypeConversionError("resource must be an object".to_string()))?;

    // Get principal ID
    let principal_id = principal_obj.get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CelError::FunctionError("principal.id not found or not a string".to_string()))?;

    // Check resource.attributes.ownerId
    if let Some(attrs) = resource_obj.get("attributes") {
        if let Some(attrs_obj) = attrs.as_object() {
            if let Some(owner_id) = attrs_obj.get("ownerId") {
                if let Some(owner_id_str) = owner_id.as_str() {
                    return Ok(principal_id == owner_id_str);
                }
            }
        }
    }

    // Check resource.attr.ownerId (alias)
    if let Some(attr) = resource_obj.get("attr") {
        if let Some(attr_obj) = attr.as_object() {
            if let Some(owner_id) = attr_obj.get("ownerId") {
                if let Some(owner_id_str) = owner_id.as_str() {
                    return Ok(principal_id == owner_id_str);
                }
            }
        }
    }

    Ok(false)
}

/// Check if a value is in a list
///
/// # Arguments
/// * `value` - Value to check
/// * `list` - List to search
///
/// # Returns
/// `true` if value is in list, `false` otherwise
///
/// # Example
/// ```cel
/// inList(resource.department, principal.allowed_departments)
/// inList("read", ["read", "write"])
/// ```
pub fn in_list(value: &Value, list: &Value) -> Result<bool> {
    let value_str = value.as_str()
        .ok_or_else(|| CelError::TypeConversionError("value must be a string".to_string()))?;

    let list_arr = list.as_array()
        .ok_or_else(|| CelError::TypeConversionError("list must be an array".to_string()))?;

    for item in list_arr {
        if let Some(item_str) = item.as_str() {
            if item_str == value_str {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_has_role_true() {
        let principal = json!({
            "id": "user123",
            "roles": ["admin", "editor"]
        });
        let role = json!("admin");

        assert!(has_role(&principal, &role).unwrap());
    }

    #[test]
    fn test_has_role_false() {
        let principal = json!({
            "id": "user123",
            "roles": ["editor"]
        });
        let role = json!("admin");

        assert!(!has_role(&principal, &role).unwrap());
    }

    #[test]
    fn test_has_role_no_roles() {
        let principal = json!({
            "id": "user123"
        });
        let role = json!("admin");

        assert!(!has_role(&principal, &role).unwrap());
    }

    #[test]
    fn test_is_owner_true() {
        let principal = json!({
            "id": "user123"
        });
        let resource = json!({
            "attributes": {
                "ownerId": "user123"
            }
        });

        assert!(is_owner(&principal, &resource).unwrap());
    }

    #[test]
    fn test_is_owner_false() {
        let principal = json!({
            "id": "user123"
        });
        let resource = json!({
            "attributes": {
                "ownerId": "user456"
            }
        });

        assert!(!is_owner(&principal, &resource).unwrap());
    }

    #[test]
    fn test_is_owner_attr_alias() {
        let principal = json!({
            "id": "user123"
        });
        let resource = json!({
            "attr": {
                "ownerId": "user123"
            }
        });

        assert!(is_owner(&principal, &resource).unwrap());
    }

    #[test]
    fn test_in_list_true() {
        let value = json!("read");
        let list = json!(["read", "write", "delete"]);

        assert!(in_list(&value, &list).unwrap());
    }

    #[test]
    fn test_in_list_false() {
        let value = json!("admin");
        let list = json!(["read", "write", "delete"]);

        assert!(!in_list(&value, &list).unwrap());
    }

    #[test]
    fn test_in_list_empty() {
        let value = json!("read");
        let list = json!([]);

        assert!(!in_list(&value, &list).unwrap());
    }
}
