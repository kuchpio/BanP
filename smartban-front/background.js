import init, { test } from "./pkg/smartban_lib.js";

const FACEIT_CLINET_API_KEY = '2e3c4f35-2878-4fd8-8de3-a046b5581256';
const FACEIT_DATA_API_ENDPOINT = 'https://open.faceit.com/data/v4/';
const STANDARD_REQUEST_HEADER = new Headers({
    'accept': 'application/json', 
    'Authorization': `Bearer ${FACEIT_CLINET_API_KEY}`
});
const MAPS = [
    {name: "Dust2", guid: "de_dust2", img: "https://liquipedia.net/commons/images/thumb/1/12/Csgo_dust2.0.jpg/534px-Csgo_dust2.0.jpg", icon: "assets/collection_icon_de_dust2.png"},
    {name: "Mirage", guid: "de_mirage", img: "https://liquipedia.net/commons/images/thumb/f/f3/Csgo_mirage.jpg/534px-Csgo_mirage.jpg", icon: "assets/collection_icon_de_mirage.png"},
    {name: "Nuke", guid: "de_nuke", img: "https://liquipedia.net/commons/images/thumb/5/5e/Nuke_csgo.jpg/534px-Nuke_csgo.jpg", icon: "assets/collection_icon_de_nuke.png"},
    {name: "Overpass", guid: "de_overpass", img: "https://liquipedia.net/commons/images/thumb/0/0f/Csgo_overpass.jpg/534px-Csgo_overpass.jpg", icon: "assets/collection_icon_de_overpass.png"},
    {name: "Train", guid: "de_train", img: "https://liquipedia.net/commons/images/thumb/5/56/Train_csgo.jpg/534px-Train_csgo.jpg", icon: "assets/collection_icon_de_train.png"},
    {name: "Inferno", guid: "de_inferno", img: "https://liquipedia.net/commons/images/thumb/2/2b/De_new_inferno.jpg/534px-De_new_inferno.jpg", icon: "assets/collection_icon_de_inferno.png"},
    {name: "Vertigo", guid: "de_vertigo", img: "https://liquipedia.net/commons/images/thumb/5/59/Csgo_de_vertigo_new.jpg/534px-Csgo_de_vertigo_new.jpg", icon: "assets/collection_icon_de_vertigo.png"},
    {name: "Ancient", guid: "de_ancient", img: "https://liquipedia.net/commons/images/thumb/3/35/Csgo_ancient.jpeg/534px-Csgo_ancient.jpeg", icon: "assets/collection_icon_de_ancient.png"},
    {name: "Anubis", guid: "de_anubis", img: "https://liquipedia.net/commons/images/5/59/Anubis_csgo.jpg", icon: "assets/collection_icon_de_anubis.png"}
];
const RECENTLY_OFFSET = 4; /* hours */

let lastMatchID = "";
init().then(() => {
    chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
        
        /* get id of current match */
        const CURRENT_MATCH_ID = details.url.split('/')[6];

        if (CURRENT_MATCH_ID === lastMatchID) return;

        test("2e3c4f35-2878-4fd8-8de3-a046b5581256", CURRENT_MATCH_ID);
        
        let [currentMatch, faction1, faction2] = await fetchMapStats(CURRENT_MATCH_ID);

        chrome.storage.sync.set({currentMatchMapTable: 
            [
                {
                    name: currentMatch.teams.faction1.name,
                    mapTable: createMapTable(MAPS, faction1)
                }, 
                {
                    name: currentMatch.teams.faction2.name,
                    mapTable: createMapTable(MAPS, faction2)
                }
            ]});

        lastMatchID = CURRENT_MATCH_ID;
        
    }, { url: [{
        hostSuffix: ".faceit.com",
        pathContains: "/csgo/room/" 
    }] });
});

async function fetchMapStats(current_match_id)
{
    const RECENTLY_VALUE = Date.now() / 1000 - RECENTLY_OFFSET * 3600;
    
    const matchResponse = await fetch(FACEIT_DATA_API_ENDPOINT + 'matches/' + current_match_id, {headers: STANDARD_REQUEST_HEADER});
    
    if (!matchResponse.ok)
    {
        console.log(`Could not fetch data from this match (id: ${current_match_id})`);
        return;
    }

    const current_match = await matchResponse.json();
    
    let faction1 = await fillFactionData(current_match.teams.faction1.roster.map(player => {return {pid: player.player_id, nickname: player.nickname}}), RECENTLY_VALUE);
    let faction2 = await fillFactionData(current_match.teams.faction2.roster.map(player => {return {pid: player.player_id, nickname: player.nickname}}), RECENTLY_VALUE);

    return [current_match, faction1, faction2];
}

async function fillFactionData(roster, recentlyValue)
{
    let playerHistories = await fetchFactionMatchHistory(roster);
    
    return playerHistories.map(playerPromise => {
        return fillPlayerData(playerPromise, recentlyValue);
    })
}

async function fetchFactionMatchHistory(roster)
{
    let historyPromises = roster.map(player => {
        let historyURL = FACEIT_DATA_API_ENDPOINT + 'players/' + player.pid + '/history?game=csgo&offset=0&limit=20';

        return new  Promise((resolve, reject) => { // getting player history
                        fetch(historyURL, {headers: STANDARD_REQUEST_HEADER})
                        .then(response => {
                            if (!response.ok) throw new Error(`Could not fetch match history of player ${player.nickname}.`);
                            return response.json();
                        })
                        .then(historyData => {
                            resolve(historyData.items);
                        })
                        .catch(error => {
                            console.log(error.message);
                            reject(error.message);
                        })
                    })
                    .then(playerHistory => {
                        let matchesPromises = playerHistory.map(matchHistoryData => {
                            let matchURL = FACEIT_DATA_API_ENDPOINT + 'matches/' + matchHistoryData.match_id + '/stats';

                            return new  Promise((resolve, reject) => { // getting match stats
                                            fetch(matchURL, {headers: STANDARD_REQUEST_HEADER})
                                            .then(response => {
                                                if (!response.ok) throw new Error(`Could not fetch match stats (match id: ${matchHistoryData.match_id}) of player ${player.nickname}.`);
                                                return response.json();
                                            })
                                            .then(matchData => {
                                                resolve({...matchData.rounds[0], finished_at: matchHistoryData.finished_at});
                                            })
                                            .catch(error => {
                                                console.log(error.message);
                                                reject(error.message);
                                            })
                                        })
                        })

                        return Promise.allSettled(matchesPromises);
                    })
                    .then(playerHistoryMatches => {
                        return {player: player, history: playerHistoryMatches};
                    })
    });

    return Promise.allSettled(historyPromises);
}

function fillPlayerData(playerPromise, recentlyValue)
{
    let player = {
        nickname: playerPromise.value.player.nickname, 
        pid: playerPromise.value.player.pid, 
        mapStats: []
    }

    playerPromise.value.history.forEach(matchPromise => {
        if (matchPromise.status === 'rejected') return;
        let matchStats = matchPromise.value;
        let player_in_team0 = false;
        let matchMap = matchStats.round_stats.Map;
        
        if (player.mapStats[matchMap] === undefined)
            player.mapStats[matchMap] = {played: 0, recentlyPlayed: 0, won: 0, totalKills: 0, totalDeaths: 0};
                        
        player.mapStats[matchMap].played++;

        if (recentlyValue < matchStats.finished_at)
            player.mapStats[matchMap].recentlyPlayed++;


        matchStats.teams[0].players.forEach(p => {
            if (p.player_id === player.pid)
            {
                player_in_team0 = true;
                player.mapStats[matchMap].totalKills += parseInt(p.player_stats.Kills);
                player.mapStats[matchMap].totalDeaths += parseInt(p.player_stats.Deaths);
            }
        })

        if (!player_in_team0)
        {
            matchStats.teams[1].players.forEach(p => {
                if (p.player_id === player.pid)
                {
                    player.mapStats[matchMap].totalKills += parseInt(p.player_stats.Kills);
                    player.mapStats[matchMap].totalDeaths += parseInt(p.player_stats.Deaths);
                }
            })
        }

        if ((player_in_team0 && matchStats.round_stats.Winner === matchStats.teams[0].team_id) || (!player_in_team0 && matchStats.round_stats.Winner !== matchStats.teams[0].team_id))
            player.mapStats[matchMap].won++;
    })

    return player;
}

function createMapTable(maps, faction)
{
    return maps.map(m => {
        let avgPlayed = avgStat(faction, m.guid, 'played');
        let avgWon = avgStat(faction, m.guid, 'won');
        let avgWinrate = avgPlayed ? Math.round(100 * avgWon / avgPlayed) / 100 : 0;
        let avgRecentlyPlayed = avgStat(faction, m.guid, 'recentlyPlayed');
        let totalKills = sumStat(faction, m.guid, 'totalKills');
        let totalDeaths = sumStat(faction, m.guid, 'totalDeaths');
        let avgKD = totalDeaths ? Math.round(100 * totalKills / totalDeaths) / 100 : 0;

        return {
            name: m.name, 
            id: m.guid, 
            img: m.img,
            icon: m.icon,
            avgPlayed: avgPlayed, 
            avgWon: avgWon,
            avgWinrate: avgWinrate,
            avgRecentlyPlayed: avgRecentlyPlayed, 
            totalKills: totalKills,
            totalDeaths: totalDeaths,
            avgKD: avgKD
        }
    })
}

function sumStat(faction, map, statKey)
{
    let sum = 0;
    faction.forEach(player => {
        sum += player.mapStats[map] ? player.mapStats[map][statKey] : 0;
    });
    return sum;
}

function avgStat(faction, map, statKey)
{
    return sumStat(faction, map, statKey) / faction.length;
}