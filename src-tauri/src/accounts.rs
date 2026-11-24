use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccountType {
    Microsoft,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String, // UUID string
    pub username: String,
    pub account_type: AccountType,
    pub uuid: String, // Minecraft Player UUID
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub skin_url: Option<String>,       // URL or local skin path
    pub skin_model: Option<String>,     // "classic" (Steve 4px) or "slim" (Alex 3px)
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AccountStore {
    pub active_account_id: Option<String>,
    pub accounts: Vec<Account>,
}

impl AccountStore {
    pub fn load_or_default(storage_path: &Path) -> Self {
        if storage_path.exists() {
            if let Ok(data) = fs::read_to_string(storage_path) {
                if let Ok(store) = serde_json::from_str::<AccountStore>(&data) {
                    return store;
                }
            }
        }
        Self::default()
    }

    pub fn save(&self, storage_path: &Path) -> Result<(), String> {
        if let Some(parent) = storage_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(storage_path, json).map_err(|e| e.to_string())
    }

    pub fn add_or_update(&mut self, account: Account) {
        if let Some(pos) = self.accounts.iter().position(|a| a.id == account.id || a.uuid == account.uuid) {
            self.accounts[pos] = account;
        } else {
            if self.accounts.is_empty() {
                self.active_account_id = Some(account.id.clone());
            }
            self.accounts.push(account);
        }
    }

    pub fn set_skin(&mut self, account_id: &str, skin_url: String, skin_model: Option<String>) -> bool {
        if let Some(acc) = self.accounts.iter_mut().find(|a| a.id == account_id) {
            acc.skin_url = Some(skin_url);
            if skin_model.is_some() {
                acc.skin_model = skin_model;
            }
            true
        } else {
            false
        }
    }

    pub fn remove(&mut self, account_id: &str) -> bool {
        let initial_len = self.accounts.len();
        self.accounts.retain(|a| a.id != account_id);
        if self.active_account_id.as_deref() == Some(account_id) {
            self.active_account_id = self.accounts.first().map(|a| a.id.clone());
        }
        self.accounts.len() < initial_len
    }

    pub fn set_active(&mut self, account_id: &str) -> bool {
        if self.accounts.iter().any(|a| a.id == account_id) {
            self.active_account_id = Some(account_id.to_string());
            true
        } else {
            false
        }
    }
}
