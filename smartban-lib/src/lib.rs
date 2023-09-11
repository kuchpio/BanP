use futures::{stream::FuturesUnordered, StreamExt};
use reqwest::{Client, header::{HeaderMap, self}};
use serde_json::Value;
use wasm_bindgen::prelude::*;

mod smartban;

#[wasm_bindgen]
extern "C" {
    // Import console.log
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[allow(unused_macros)]
macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[derive(Debug)]
struct TeamData {
    name: String,
    leader: String, 
    players: Vec<String>
}

#[derive(Debug)]
struct HistoryMatchData {
    match_id: String,
    finished_at: u64,
}

#[derive(Debug)]
struct PlayerMatchStats {
    player_id: String, 
    match_id: String, 
    finished_at: u64,
    map: String, 
    win: bool,
    kills: u64,
    deaths: u64
}

pub struct SmartbanWorker {
    req_client: Client,
    history_depth: u8,
    recently_threshold_hours: u32,
}

impl SmartbanWorker {
    pub fn new(faceit_access_token: &str, history_depth: u8, recently_threshold_hours: u32) -> Result<Self, SmartBanError> {
        let mut default_header = HeaderMap::new();

        let mut auth_value = header::HeaderValue::from_str(format!("Bearer {}", faceit_access_token).as_str())
            .map_err(|_| SmartBanError::RequestClientInitialization)?;
        auth_value.set_sensitive(true);
        default_header.insert(header::ACCEPT, header::HeaderValue::from_static("application/json"));
        default_header.insert(header::AUTHORIZATION, auth_value);

        let client = reqwest::Client::builder()
            .default_headers(default_header)
            .build()
            .map_err(|_| SmartBanError::RequestClientInitialization)?;

        Ok(SmartbanWorker {
            req_client: client,
            history_depth,
            recently_threshold_hours
        })
    }

    pub fn set_history_depth(&mut self, history_depth: u8) {
        self.history_depth = history_depth;
    }

    pub fn set_recently_threshold_hours(&mut self, recently_threshold_hours: u32) {
        self.recently_threshold_hours = recently_threshold_hours;
    }

    async fn json_from_url(&self, url: &str) -> Result<Value, SmartBanError> {
        Ok(
            self.req_client
                .get(url)
                .send().await?
                .json().await?
        )
    }

    fn team_data_from_value(team_value: Option<&Value>) -> Result<TeamData, SmartBanError> {
        let name = team_value
            .and_then(|team_value| team_value.get("name"))
            .and_then(|name| name.as_str())
            .and_then(|name| Some(name.to_string()));

        let leader = team_value
            .and_then(|team_value| team_value.get("leader"))
            .and_then(|leader| leader.as_str())
            .and_then(|leader| Some(leader.to_string()));

        let players = team_value
            .and_then(|team_value| team_value.get("roster"))
            .and_then(|players| players.as_array())
            .and_then(|players| Some(players.iter().filter_map(|player| player.get("player_id")
                .and_then(|player_id| player_id.as_str())
                .and_then(|player_id| Some(player_id.to_string()))
        ).collect()));

        if let (Some(name), Some(leader), Some(players)) = (name, leader, players) {
            Ok(TeamData { name, leader, players })
        } else {
            Err(SmartBanError::DataDeserialization(String::from("name, leader, players")))
        }
    }

    async fn get_match_teams(&self, match_id: &str) -> Result<(TeamData, TeamData), SmartBanError> {
        let match_data: Value = self.req_client
            .get(format!("https://open.faceit.com/data/v4/matches/{}", match_id))
            .send().await?
            .json().await?;

        let left_team_value = match_data.get("teams")
            .and_then(|teams| teams.get("faction1"));

        let right_team_value = match_data.get("teams")
            .and_then(|teams| teams.get("faction2"));

        let left_team = Self::team_data_from_value(left_team_value)?;
        let right_team = Self::team_data_from_value(right_team_value)?;
        
        Ok((left_team, right_team))
    }

    async fn get_player_match_history(&self, player_id: &str, limit: u8) -> Result<Vec<HistoryMatchData>, SmartBanError> {
        let player_history: Value = self.req_client
            .get(format!("https://open.faceit.com/data/v4/players/{}/history?game=csgo&offset=0&limit={}", player_id, limit))
            .send().await?
            .json().await?;

        player_history.get("items")
            .and_then(|items| items.as_array())
            .and_then(|matches| Some(matches.iter().filter_map(|match_value| {

                let match_id_res = match_value.get("match_id")
                    .and_then(|match_id| match_id.as_str())
                    .and_then(|match_id_str| Some(String::from(match_id_str)));

                let finished_at_res = match_value.get("finished_at")
                    .and_then(|finished_at| finished_at.as_u64());

                if let (Some(match_id), Some(finished_at)) = (match_id_res, finished_at_res) {
                    return Some(HistoryMatchData {match_id, finished_at});
                } else {
                    return None;
                }
            }).collect()))
            .ok_or(SmartBanError::DataDeserialization(String::from("match_id, finished_at")))
    }

    async fn get_player_match_stats(&self, player_id: &str, history_match: HistoryMatchData) -> Result<PlayerMatchStats, SmartBanError> {
        let match_stats_response: Value = self.req_client
            .get(format!("https://open.faceit.com/data/v4/matches/{}/stats", history_match.match_id))
            .send().await?
            .json().await?;

        let match_stats = match_stats_response
            .get("rounds")
            .and_then(|rounds| rounds.as_array())
            .and_then(|rounds| rounds.first());

        let map: Option<String> = match_stats
            .and_then(|match_stats| match_stats.get("round_stats"))
            .and_then(|round_stats| round_stats.get("Map"))
            .and_then(|map| map.as_str())
            .and_then(|map| Some(map.to_string()));

        let player_stats = match_stats
            .and_then(|match_stats| match_stats.get("teams"))
            .and_then(|teams| teams.as_array())
            .and_then(|teams| teams.get(0..=1))
            .and_then(|teams| teams.iter()
                .filter_map(|team| team.get("players")
                    .and_then(|players| players.as_array())
                    .and_then(|players| players.iter().find(|&player| 
                        Some(true) == player.get("player_id")
                            .and_then(|player_id| player_id.as_str())
                            .and_then(|pid| Some(pid == player_id))
                ))).last()
            .and_then(|player| player.get("player_stats")));

        let player_won = Some(1) == player_stats
            .and_then(|stats| stats.get("Result"))
            .and_then(|result| result.as_str())
            .and_then(|result| result.parse::<u64>().ok());

        let kills = player_stats
            .and_then(|stats| stats.get("Kills"))
            .and_then(|kills| kills.as_str())
            .and_then(|kills| kills.parse::<u64>().ok());

        let deaths = player_stats
            .and_then(|stats| stats.get("Deaths"))
            .and_then(|deaths| deaths.as_str())
            .and_then(|deaths| deaths.parse::<u64>().ok());

        if let (Some(map), Some(kills), Some(deaths)) = (map, kills, deaths) {
            Ok(PlayerMatchStats { 
                player_id: player_id.to_string(), 
                match_id: history_match.match_id.to_string(), 
                finished_at: history_match.finished_at,
                map,  
                win: player_won,
                kills,
                deaths
            })
        } else {
            Err(SmartBanError::DataDeserialization(String::from("map, kills, deaths")))
        }
    }

    async fn get_player_recent_stats(&self, player_id: &str) -> Result<Vec<PlayerMatchStats>, SmartBanError>
    {
        Ok(
            self.get_player_match_history(player_id, self.history_depth)
                .await?
                .into_iter()
                .map(|history_match| self.get_player_match_stats(player_id, history_match))
                .collect::<FuturesUnordered<_>>()
                .collect::<Vec<_>>()
                .await
                .into_iter()
                .filter_map(|player_stats_result| player_stats_result.ok())
                .collect()
        )
    }

    async fn get_team_stats(&self, team_data: &TeamData) -> Vec<PlayerMatchStats>
    {
        team_data.players
            .iter()
            .map(|player_id| self.get_player_recent_stats(player_id))
            .collect::<FuturesUnordered<_>>()
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .flat_map(|player_stats_result| {
                match player_stats_result {
                    Ok(player_stats) => player_stats, 
                    Err(err) => {
                        err.log();
                        Vec::new()
                    }
                }
            }).collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::SmartbanWorker;

    const FACEIT_ACCESS_TOKEN: &str = "2e3c4f35-2878-4fd8-8de3-a046b5581256";
    const SAMPLE_MATCH_ID: &str = "1-bce31260-7618-441a-aa1d-71b8719a5ec5";

    #[tokio::test]
    async fn match_test() {
        let worker = SmartbanWorker::new(FACEIT_ACCESS_TOKEN, 20, 4).unwrap();
        let (left_team, right_team) = worker.get_match_teams(SAMPLE_MATCH_ID).await.unwrap();
        
        println!("Left team: {:?}", left_team);
        println!("Right team: {:?}", right_team);

        // println!("Left team stats: {:?}", worker.get_team_stats(&left_team).await);
        // println!("Right team stats: {:?}", worker.get_team_stats(&right_team).await);
    }
}

#[wasm_bindgen]
pub async fn test(faceit_access_token: &str, match_id: &str) {
    let worker = SmartbanWorker::new(faceit_access_token, 20, 4).unwrap();

    match worker.get_match_teams(match_id).await {
        Ok((left_team, right_team)) => {
            console_log!("Left team: {:?}", left_team);
            console_log!("Left team stats: {:?}", worker.get_team_stats(&left_team).await);

            console_log!("Right team: {:?}", right_team);
            console_log!("Right team stats: {:?}", worker.get_team_stats(&right_team).await);
        }
        Err(err) => err.log()
    };
}
