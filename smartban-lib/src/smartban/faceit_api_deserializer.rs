use serde_json::Value;

#[derive(Debug)]
pub enum TeamSide {
    Left,
    Right,
}

#[derive(Debug)]
pub struct TeamData {
    name: String,
    side: TeamSide,
    players: Vec<PlayerData>,
}

#[derive(Debug)]
pub struct PlayerData {
    player_id: String, 
    nickname: String, 
    skill_level: u8, 
    is_leader: bool, 
    match_history: Vec<PlayerMatchStats>
}

#[derive(Debug)]
pub struct PlayerMatchStats {
    match_id: String,
    finished_at: u64,
    map: String,
    win: bool,
    kills: u64,
    deaths: u64, 
    rounds_won: u64, 
    rounds_lost: u64
}

#[derive(Debug)]
struct HistoryData {
    match_id: String,
    finished_at: u64,
}

pub fn deserialize_team_data(match_json: Value, side: TeamSide) -> Option<TeamData> {
    let team_json_name = match side {
        Left => "faction1",
        Right => "faction2",
    };

    let team_value = match_json
        .get("teams")
        .and_then(|teams| teams.get(team_json_name))?;

    let name = team_value
        .get("name")
        .and_then(|name| name.as_str())
        .and_then(|name| Some(name.to_string()))?;

    let leader = team_value
        .get("leader")
        .and_then(|leader| leader.as_str())
        .and_then(|leader| Some(leader.to_string()))?;

    let players = team_value
        .get("roster")
        .and_then(|players| players.as_array())
        .and_then(|players| {
            Some(
                players
                    .iter()
                    .filter_map(|player| {
                        player
                            .get("player_id")
                            .and_then(|player_id| player_id.as_str())
                            .and_then(|player_id| Some(player_id.to_string()))
                    })
                    .collect(),
            )
        })?;

    Some(TeamData {
        name,
        leader,
        side,
        players,
    })
}

pub fn retrieve_history(history_json: Value) -> Vec<HistoryData> {
    history_json
        .get("items")
        .and_then(|items| items.as_array())
        .and_then(|matches| {
            Some(
                matches
                    .iter()
                    .filter_map(|match_value| {
                        let match_id = match_value
                            .get("match_id")
                            .and_then(|match_id| match_id.as_str())
                            .and_then(|match_id_str| Some(String::from(match_id_str)))?;

                        let finished_at = match_value
                            .get("finished_at")
                            .and_then(|finished_at| finished_at.as_u64())?;

                        Some(HistoryData {
                            match_id,
                            finished_at,
                        })
                    })
                    .collect(),
            )
        })
        .unwrap_or(Vec::new())
}

pub fn retrieve_player_stats(
    match_stats_json: Value,
    player_id: &str,
    history_data: HistoryData,
) -> Option<PlayerMatchStats> {
    let match_stats = match_stats_json
        .get("rounds")
        .and_then(|rounds| rounds.as_array())
        .and_then(|rounds| rounds.first())?;

    let map = match_stats
        .get("round_stats")
        .and_then(|round_stats| round_stats.get("Map"))
        .and_then(|map| map.as_str())
        .and_then(|map| Some(map.to_string()))?;

    let player_stats = match_stats
        .get("teams")
        .and_then(|teams| teams.as_array())
        .and_then(|teams| teams.get(0..=1))
        .and_then(|teams| {
            teams
                .iter()
                .filter_map(|team| {
                    team.get("players")
                        .and_then(|players| players.as_array())
                        .and_then(|players| {
                            players.iter().find(|&player| {
                                Some(true)
                                    == player
                                        .get("player_id")
                                        .and_then(|player_id| player_id.as_str())
                                        .and_then(|pid| Some(pid == player_id))
                            })
                        })
                })
                .last()
                .and_then(|player| player.get("player_stats"))
        })?;

    let player_won = 1
        == player_stats
            .get("Result")
            .and_then(|result| result.as_str())
            .and_then(|result| result.parse::<u64>().ok())?;

    let kills = player_stats
        .get("Kills")
        .and_then(|kills| kills.as_str())
        .and_then(|kills| kills.parse::<u64>().ok())?;

    let deaths = player_stats
        .get("Deaths")
        .and_then(|deaths| deaths.as_str())
        .and_then(|deaths| deaths.parse::<u64>().ok())?;

    Some(PlayerMatchStats {
        player_id: player_id.to_string(),
        match_id: history_data.match_id.to_string(),
        finished_at: history_data.finished_at,
        map,
        win: player_won,
        kills,
        deaths,
    })
}
