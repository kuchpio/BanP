use reqwest::{
    header::{self, HeaderMap},
    Client,
};
use serde_json::Value;

pub struct FaceitAPIClient {
    client: Client,
}

impl FaceitAPIClient {
    pub fn new(faceit_access_token: &str) -> Option<Self> {
        let mut default_header = HeaderMap::new();
        default_header.insert(
            header::ACCEPT,
            header::HeaderValue::from_static("application/json"),
        );
        default_header.insert(
            header::AUTHORIZATION,
            header::HeaderValue::from_str(&format!("Bearer {}", faceit_access_token)).ok()?,
        );

        let client = reqwest::Client::builder()
            .default_headers(default_header)
            .build()
            .ok()?;

        Some(FaceitAPIClient { client })
    }

    async fn json_from_url(&self, url: &str) -> reqwest::Result<Value> {
        Ok(self.client.get(url).send().await?.json().await?)
    }

    pub async fn get_match_json(&self, match_id: &str) -> reqwest::Result<Value> {
        self.json_from_url(&format!(
            "https://open.faceit.com/data/v4/matches/{}",
            match_id
        ))
        .await
    }

    pub async fn get_history_json(&self, player_id: &str, limit: u32) -> reqwest::Result<Value> {
        self.json_from_url(&format!(
            "https://open.faceit.com/data/v4/players/{}/history?game=csgo&offset=0&limit={}",
            player_id, limit
        ))
        .await
    }

    pub async fn get_match_stats_json(&self, match_id: &str) -> reqwest::Result<Value> {
        self.json_from_url(&format!(
            "https://open.faceit.com/data/v4/matches/{}/stats",
            match_id
        ))
        .await
    }
}
