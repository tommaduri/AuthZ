use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Principal {
    pub id: String,
    pub roles: Vec<String>,
    pub attributes: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Resource {
    pub id: String,
    pub kind: String,
    pub attributes: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DerivedRole {
    pub name: String,
    pub parent_roles: Vec<String>,
    pub condition: String,
}

impl DerivedRole {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.is_empty() {
            return Err("derived role name cannot be empty".to_string());
        }
        if self.parent_roles.is_empty() {
            return Err("derived role must have at least one parent role".to_string());
        }
        Ok(())
    }

    pub fn matches(&self, roles: &[String]) -> bool {
        for parent in &self.parent_roles {
            if parent == "*" {
                return true;
            }
            if parent.contains('*') {
                let pattern = parent.replace('*', ".*");
                if let Ok(re) = regex::Regex::new(&format!("^{}$", pattern)) {
                    if roles.iter().any(|r| re.is_match(r)) {
                        return true;
                    }
                }
            } else if roles.contains(parent) {
                return true;
            }
        }
        false
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RoleGraphNode {
    pub name: String,
    pub dependencies: Vec<String>,
}

impl RoleGraphNode {
    pub fn new(name: String) -> Self {
        Self {
            name,
            dependencies: Vec::new(),
        }
    }

    pub fn add_dependency(&mut self, dep: String) {
        if !self.dependencies.contains(&dep) {
            self.dependencies.push(dep);
        }
    }
}
