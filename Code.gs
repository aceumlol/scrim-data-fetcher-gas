/******************************************************************************
 * League of Legends Scrim Data Fetcher
 * Data Source: GRID (lol.grid.gg)
 * 
 * Fetches scrim match data including player stats, team objectives, and draft picks
 * Outputs to three separate sheets: Player Data, Team Data, and Draft Data
 * 
 * License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 ******************************************************************************/

// ===== Configuration =====

// Get your API key from https://developers.grid.gg/
const API_KEY = "YOUR_API_KEY_HERE";
const BASE_URL = "https://api.grid.gg";

// Manual date override - leave empty to run for current day
// Format: "YYYY-MM-DD"
const MANUAL_START_DATE = "";
const MANUAL_END_DATE = "";

// Sheet names for data output
const PLAYER_SHEET_NAME = "Player Data";
const TEAM_SHEET_NAME = "Team Data";
const DRAFT_SHEET_NAME = "Draft Data";

// API rate limiting
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 5000;
const API_CALL_DELAY_MS = 2100;

// ===== Main Entry Point =====

function runDailyUpdate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const timezone = ss.getSpreadsheetTimeZone();
  
  // Determine date range
  let startDate, endDate;
  if (MANUAL_START_DATE && MANUAL_END_DATE) {
    Logger.log("Using manual date range");
    startDate = MANUAL_START_DATE;
    endDate = MANUAL_END_DATE;
  } else {
    Logger.log("Using current date");
    const today = new Date();
    startDate = Utilities.formatDate(today, timezone, "yyyy-MM-dd");
    endDate = startDate;
  }
  
  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    const msg = "Invalid date format. Use YYYY-MM-DD";
    Logger.log(msg);
    SpreadsheetApp.getUi().alert(msg);
    return;
  }

  Logger.log(`Fetching data from ${startDate} to ${endDate}`);
  ss.toast(`Fetching scrims from ${startDate} to ${endDate}`);

  setupSheets(ss);
  
  const seriesList = fetchScrimSeries(startDate, endDate);
  if (!seriesList || seriesList.length === 0) {
    const msg = `No scrims found between ${startDate} and ${endDate}`;
    Logger.log(msg);
    if (MANUAL_START_DATE) {
      SpreadsheetApp.getUi().alert(msg);
    }
    return;
  }

  // Process each series
  let playerData = [], teamData = [], draftData = [];
  let successCount = 0, failCount = 0;

  for (let i = 0; i < seriesList.length; i++) {
    const series = seriesList[i].node;
    const teamNames = series.teams.map(t => t.baseInfo.name).filter(n => n);
    
    if (teamNames.length < 2) continue;

    const statusMsg = `Processing ${i + 1}/${seriesList.length}: ${teamNames[0]} vs ${teamNames[1]}`;
    Logger.log(statusMsg);
    ss.toast(statusMsg);

    const gameData = processSeries(series.id, teamNames, timezone);
    if (gameData) {
      playerData.push(...gameData.players);
      teamData.push(...gameData.teams);
      draftData.push(gameData.draft);
      successCount++;
    } else {
      failCount++;
    }
  }

  // Write everything to sheets
  Logger.log("Writing data to sheets");
  ss.toast("Saving data...");

  appendToSheet(ss, PLAYER_SHEET_NAME, playerData);
  appendToSheet(ss, TEAM_SHEET_NAME, teamData);
  appendToSheet(ss, DRAFT_SHEET_NAME, draftData);

  const summary = `Done! Processed ${successCount} games, ${failCount} failed`;
  Logger.log(summary);
  if (MANUAL_START_DATE) {
    SpreadsheetApp.getUi().alert(summary);
  }
}

// ===== Sheet Setup =====

function setupSheets(ss) {
  const headers = {
    [PLAYER_SHEET_NAME]: [
      "game_id", "date", "team1", "team2", "duration", "winner", "patch",
      "champion", "nickname", "kills", "deaths", "assists", "creep_score",
      "dmg_to_champs", "dmg_to_turrets", "gold", "vision_score",
      "wards_placed", "control_wards", "wards_cleared",
      "gold_8", "gold_14", "cs_8", "cs_14"
    ],
    [TEAM_SHEET_NAME]: [
      "game_id", "date", "team1", "team2", "duration", "winner", "patch", "side",
      "grubs1", "grubs2", "first_drake", "herald", "atakhan", "first_tower",
      "nashors_taken", "towers_taken", "drakes_taken"
    ],
    [DRAFT_SHEET_NAME]: [
      "game_id", "date", "team1", "team2", "patch", "duration",
      "BB1", "RB1", "BB2", "RB2", "BB3", "RB3", "BB4", "RB4", "BB5", "RB5",
      "BP1", "RP1", "RP2", "BP2", "BP3", "RP3", "RP4", "BP4", "BP5", "RP5"
    ]
  };

  Object.keys(headers).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers[sheetName]);
      sheet.getRange(1, 1, 1, headers[sheetName].length).setFontWeight('bold');
    } else if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers[sheetName]);
      sheet.getRange(1, 1, 1, headers[sheetName].length).setFontWeight('bold');
    }
  });
}

// ===== API Calls =====

function fetchScrimSeries(startDate, endDate) {
  const query = `
    query GetScrimSeries($first: Int!, $after: Cursor, $filter: SeriesFilter!) {
      allSeries(first: $first, after: $after, filter: $filter, 
                orderBy: StartTimeScheduled, orderDirection: DESC) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            startTimeScheduled
            teams { baseInfo { name } }
          }
        }
      }
    }
  `;
  
  let allSeries = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const variables = {
      first: 50,
      after: cursor,
      filter: {
        titleId: 3,
        types: ["SCRIM"],
        startTimeScheduled: {
          gte: `${startDate}T00:00:00Z`,
          lte: `${endDate}T23:59:59Z`
        }
      }
    };

    const payload = {
      query: query,
      variables: variables
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    Utilities.sleep(API_CALL_DELAY_MS);
    const response = UrlFetchApp.fetch(`${BASE_URL}/central-data/graphql`, options);
    const result = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || result.errors) {
      Logger.log(`GraphQL error: ${JSON.stringify(result.errors)}`);
      return null;
    }
    
    const data = result.data.allSeries;
    allSeries.push(...data.edges);
    hasMore = data.pageInfo.hasNextPage;
    cursor = data.pageInfo.endCursor;
    
    Logger.log(`Fetched ${data.edges.length} series (total: ${allSeries.length})`);
  }
  
  return allSeries;
}

function fetchWithRetry(url) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      Utilities.sleep(API_CALL_DELAY_MS);
      
      const options = {
        headers: { 'x-api-key': API_KEY },
        muteHttpExceptions: true
      };
      
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();

      if (code === 200) {
        return JSON.parse(response.getContentText());
      }
      
      if (code === 429) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        Logger.log(`Rate limited, waiting ${delay/1000}s`);
        Utilities.sleep(delay);
        continue;
      }
      
      Logger.log(`Request failed with status ${code}`);
      return null;
      
    } catch (e) {
      Logger.log(`Fetch error: ${e.toString()}`);
      if (attempt < MAX_RETRIES - 1) {
        Utilities.sleep(BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }
  
  Logger.log(`Failed to fetch ${url} after ${MAX_RETRIES} attempts`);
  return null;
}

function getGameData(seriesId) {
  const summary = fetchWithRetry(
    `${BASE_URL}/file-download/end-state/riot/series/${seriesId}/games/1/summary`
  );
  if (!summary) return null;
  
  const details = fetchWithRetry(
    `${BASE_URL}/file-download/end-state/riot/series/${seriesId}/games/1/details`
  );
  if (!details) return null;
  
  return { summary, details };
}

function getDraftData(seriesId) {
  return fetchWithRetry(
    `${BASE_URL}/file-download/end-state/grid/series/${seriesId}`
  );
}

// ===== Data Processing =====

function processSeries(seriesId, teamNames, timezone) {
  const gameData = getGameData(seriesId);
  const draftJson = getDraftData(seriesId);

  if (!gameData || !draftJson) {
    Logger.log(`Failed to get data for series ${seriesId}`);
    return null;
  }

  try {
    const { summary, details } = gameData;
    const frames = details.frames || [];
    
    // Extract basic game info
    const timestamp = summary.gameStartTime || summary.gameCreation || summary.timestamp;
    const gameInfo = {
      id: `${seriesId}-1`,
      date: timestamp ? Utilities.formatDate(new Date(timestamp), timezone, "yyyy-MM-dd HH:mm:ss") : "N/A",
      duration: summary.gameDuration || 0,
      patch: summary.gameVersion || "N/A",
      winner: summary.teams[0].win ? "Blue" : "Red"
    };

    // Build player rows
    const players = [];
    summary.participants.forEach(p => {
      const pid = String(p.participantId);
      players.push([
        gameInfo.id, gameInfo.date, teamNames[0], teamNames[1],
        gameInfo.duration, gameInfo.winner, gameInfo.patch,
        p.championName || "Unknown",
        p.summonerName || p.riotIdGameName || "Unknown",
        p.kills || 0, p.deaths || 0, p.assists || 0,
        (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0),
        p.totalDamageDealtToChampions || 0,
        p.damageDealtToTurrets || 0,
        p.goldEarned || 0,
        p.visionScore || 0,
        p.wardsPlaced || 0,
        p.detectorWardsPlaced || 0,
        p.wardsKilled || 0,
        getStatAtMinute(frames, 8, pid, 'totalGold'),
        getStatAtMinute(frames, 14, pid, 'totalGold'),
        getStatAtMinute(frames, 8, pid, 'cs'),
        getStatAtMinute(frames, 14, pid, 'cs')
      ]);
    });

    // Figure out team IDs from draft data
    const game = draftJson.seriesState.games[0];
    let team1Id = null, team2Id = null;
    
    if (game.teams && game.teams.length >= 2) {
      team1Id = game.teams[0].id;
      team2Id = game.teams[1].id;
    } else {
      const actions = game.draftActions || [];
      const ids = [...new Set(actions.map(a => a.drafter?.id).filter(id => id))];
      if (ids.length >= 2) {
        team1Id = ids[0];
        team2Id = ids[1];
      }
    }

    if (!team1Id || !team2Id) {
      Logger.log(`Warning: couldn't determine team IDs for ${seriesId}`);
    }

    // Build team rows
    const teams = [];
    const blueTeam = summary.teams.find(t => t.teamId === 100);
    const redTeam = summary.teams.find(t => t.teamId === 200);
    
    const gridTeams = draftJson.seriesState.teams || [];
    const blueGridTeam = gridTeams.find(t => t.id === team1Id);
    const redGridTeam = gridTeams.find(t => t.id === team2Id);
    
    const getGrubs = (gridTeam) => {
      if (!gridTeam) return 0;
      const grubObj = (gridTeam.objectives || []).find(obj => obj.id === 'slayVoidGrub');
      return grubObj?.completionCount || 0;
    };

    if (blueTeam) {
      teams.push([
        gameInfo.id, gameInfo.date, teamNames[0], teamNames[1],
        gameInfo.duration, gameInfo.winner, gameInfo.patch, "Blue",
        "-",
        getGrubs(blueGridTeam),
        blueTeam.objectives.dragon.first ? 1 : 0,
        blueTeam.objectives.riftHerald.first ? 1 : 0,
        blueTeam.objectives.baron.first ? 1 : 0,
        blueTeam.objectives.tower.first ? 1 : 0,
        blueTeam.objectives.baron.kills || 0,
        blueTeam.objectives.tower.kills || 0,
        blueTeam.objectives.dragon.kills || 0
      ]);
    }

    if (redTeam) {
      teams.push([
        gameInfo.id, gameInfo.date, teamNames[0], teamNames[1],
        gameInfo.duration, gameInfo.winner, gameInfo.patch, "Red",
        "-",
        getGrubs(redGridTeam),
        redTeam.objectives.dragon.first ? 1 : 0,
        redTeam.objectives.riftHerald.first ? 1 : 0,
        redTeam.objectives.baron.first ? 1 : 0,
        redTeam.objectives.tower.first ? 1 : 0,
        redTeam.objectives.baron.kills || 0,
        redTeam.objectives.tower.kills || 0,
        redTeam.objectives.dragon.kills || 0
      ]);
    }

    // Build draft row
    let draft;
    if (!team1Id || !team2Id) {
      draft = [
        gameInfo.id, gameInfo.date, teamNames[0], teamNames[1],
        gameInfo.patch, gameInfo.duration,
        ...Array(20).fill("ERROR")
      ];
    } else {
      const draftInfo = extractDraft(game.draftActions, team1Id, team2Id);
      draft = [
        gameInfo.id, gameInfo.date, teamNames[0], teamNames[1],
        gameInfo.patch, gameInfo.duration,
        ...draftInfo.blueBans,
        ...draftInfo.redBans.slice(0, 5).reduce((acc, ban, i) => 
          [...acc, ban, draftInfo.blueBans[i + 5] || ''], []
        ).slice(0, 10),
        ...interleave(draftInfo.bluePicks, draftInfo.redPicks)
      ];
    }

    return { players, teams, draft };

  } catch (e) {
    Logger.log(`Error processing ${seriesId}: ${e.toString()}`);
    return null;
  }
}

function extractDraft(actions, team1Id, team2Id) {
  let blueBans = [], redBans = [], bluePicks = [], redPicks = [];

  actions.forEach(action => {
    const champ = action.draftable?.name;
    if (!champ) return;

    const teamId = action.drafter?.id;
    const isBan = action.type === 'ban';
    const isPick = action.type === 'pick';

    if (teamId === team1Id) {
      if (isBan) blueBans.push(champ);
      if (isPick) bluePicks.push(champ);
    } else if (teamId === team2Id) {
      if (isBan) redBans.push(champ);
      if (isPick) redPicks.push(champ);
    }
  });

  const pad = (arr) => [...arr, ...Array(5 - arr.length).fill('')];
  return {
    blueBans: pad(blueBans),
    redBans: pad(redBans),
    bluePicks: pad(bluePicks),
    redPicks: pad(redPicks)
  };
}

function getStatAtMinute(frames, minute, participantId, stat) {
  try {
    const frame = frames[Math.min(minute, frames.length - 1)];
    const pFrame = frame.participantFrames[participantId];
    if (!pFrame) return 0;
    
    if (stat === 'cs') {
      return (pFrame.minionsKilled || 0) + (pFrame.jungleMinionsKilled || 0);
    }
    return pFrame[stat] || 0;
  } catch (e) {
    return 0;
  }
}

function interleave(arr1, arr2) {
  const result = [];
  const maxLen = Math.max(arr1.length, arr2.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < arr1.length) result.push(arr1[i]);
    if (i < arr2.length) result.push(arr2[i]);
  }
  return result;
}

function appendToSheet(ss, sheetName, data) {
  if (!data || data.length === 0) return;
  
  const sheet = ss.getSheetByName(sheetName);
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, data.length, data[0].length).setValues(data);
}
