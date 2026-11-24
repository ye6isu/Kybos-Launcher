use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XBLResponse {
    #[serde(rename = "Token")]
    pub token: String,
    #[serde(rename = "DisplayClaims")]
    pub display_claims: DisplayClaims,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayClaims {
    pub xui: Vec<XuiClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XuiClaim {
    pub uhs: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftAuthResponse {
    pub access_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftProfileResponse {
    pub id: String,
    pub name: String,
    pub skins: Option<Vec<MinecraftProfileSkin>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftProfileSkin {
    pub id: String,
    pub state: String,
    pub url: String,
    pub variant: Option<String>,
}

pub struct MicrosoftAuth;

impl MicrosoftAuth {
    // Official Microsoft Entra Public Client ID for Minecraft launchers
    const CLIENT_ID: &'static str = "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb";

    /// Initiates Device Authorization Flow
    pub async fn request_device_code() -> Result<DeviceCodeResponse, String> {
        let client = reqwest::Client::new();
        let params = [
            ("client_id", Self::CLIENT_ID),
            ("scope", "XboxLive.SignIn XboxLive.offline_access"),
        ];

        let resp = client
            .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode")
            .form(&params)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;

        if !status.is_success() {
            return Err(format!("Microsoft device code error (HTTP {}): {}", status, text));
        }

        serde_json::from_str::<DeviceCodeResponse>(&text)
            .map_err(|e| format!("Failed to parse device code response: {} - body: {}", e, text))
    }

    /// Polls Microsoft for user token completion
    pub async fn poll_for_token(device_code: &str) -> Result<Option<TokenResponse>, String> {
        let client = reqwest::Client::new();
        let params = [
            ("client_id", Self::CLIENT_ID),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code),
        ];

        let resp = client
            .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
            .form(&params)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if resp.status().is_success() {
            let token_res = resp.json::<TokenResponse>().await.map_err(|e| e.to_string())?;
            return Ok(Some(token_res));
        }

        Ok(None)
    }

    /// Authenticate with Xbox Live using Microsoft OAuth access token
    pub async fn authenticate_xbox_live(ms_token: &str) -> Result<XBLResponse, String> {
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={}", ms_token)
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        });

        let resp = client
            .post("https://user.auth.xboxlive.com/user/authenticate")
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        resp.json::<XBLResponse>().await.map_err(|e| e.to_string())
    }

    /// Authenticate with XSTS using Xbox Live token
    pub async fn authenticate_xsts(xbl_token: &str) -> Result<XBLResponse, String> {
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl_token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        });

        let resp = client
            .post("https://xsts.auth.xboxlive.com/xsts/authorize")
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        resp.json::<XBLResponse>().await.map_err(|e| e.to_string())
    }

    /// Authenticate with Minecraft Services using XSTS token & uhs
    pub async fn authenticate_minecraft(uhs: &str, xsts_token: &str) -> Result<MinecraftAuthResponse, String> {
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token)
        });

        let resp = client
            .post("https://api.minecraftservices.com/authentication/login_with_xbox")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        resp.json::<MinecraftAuthResponse>().await.map_err(|e| e.to_string())
    }

    /// Fetch Minecraft Profile
    pub async fn fetch_minecraft_profile(mc_token: &str) -> Result<MinecraftProfileResponse, String> {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://api.minecraftservices.com/minecraft/profile")
            .header("Authorization", format!("Bearer {}", mc_token))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err("Account does not own Minecraft or failed to fetch profile".to_string());
        }

        resp.json::<MinecraftProfileResponse>().await.map_err(|e| e.to_string())
    }
}
