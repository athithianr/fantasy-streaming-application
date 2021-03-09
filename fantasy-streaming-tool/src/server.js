const express = require('express')
const app = express()
const cors = require('cors')
const qs = require('qs')
const config = require('./conf')
const fetch = require('node-fetch')
const fs = require('fs');
const auth = require('./auth.json')
const axios = require('axios')
const parseString = require('xml2js').parseString;

app.use(cors())

const AUTH_HEADER = Buffer.from(`${config.CONSUMER_KEY}:${config.CONSUMER_SECRET}`).toString(`base64`);
const AUTH_FILE = "/Users/arajkumar/Desktop/fantasy-streaming-application/fantasy-streaming-tool/src/auth.json"

app.get('/', (req, res) => {
  res.status(200).send(`Hello World! Our server is running at port ${port}`);
});

//write to external file
function writeToFile(data, file, flag) {
  if (flag === null) {
    flag = `a`;
  }
  fs.writeFile(file, data, { flag }, (err) => {
    if (err) {
      console.error(`Error in writing to ${file}: ${err}`);
    }
  });
  return 1;
}

function refreshAuthorizationToken(token) {
  return axios({
    url: "https://api.login.yahoo.com/oauth2/get_token",
    method: "post",
    headers: {
      Authorization: `Basic ${AUTH_HEADER}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.109 Safari/537.36",
    },
    data: qs.stringify({
      redirect_uri: "oob",
      grant_type: "refresh_token",
      refresh_token: token,
    }),
  }).catch((err) => {
    console.error(`Error in refreshAuthorizationToken(): ${err}`);
  });
}

//general purpose function to make API requests
async function makeAPIrequest(url) {
  let response;
  try {
    response = await axios({
      url,
      method: "get",
      headers: {
        'Authorization': `Bearer ${auth.access_token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.109 Safari/537.36",
      },
    });
    return response
  } catch (err) {
    if (err.response.data && err.response.data.error && err.response.data.error.description && err.response.data.error.description.includes("token_expired")) {
      const newToken = await refreshAuthorizationToken(auth.refresh_token);
      if (newToken && newToken.data && newToken.data.access_token) {
        writeToFile(JSON.stringify(newToken.data), AUTH_FILE, "w");
        return makeAPIrequest(url, newToken.data.access_token, newToken.data.refresh_token);
      }
    }
    else {
      console.error(`Error with credentials in makeAPIrequest()/refreshAuthorizationToken(): ${err}`);
    }
    return err;
  }
}


app.get('/authorize', async (request, res) => {
  const url = "https://api.login.yahoo.com/oauth2/get_token"
  const options =
  {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${AUTH_HEADER}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: qs.stringify
      ({
        client_id: config.CONSUMER_KEY,
        client_secret: config.CONSUMER_SECRET,
        redirect_uri: 'oob',
        code: conf.YAHOO_AUTH_CODE,
        grant_type: 'authorization_code'
      }),
  }
  const fetch_res = await fetch(url, options)
  const json = await fetch_res.json()
  console.log(json)
}
)

app.get('/setup', async (request, res) => {
  const response = await makeAPIrequest('https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1//games;game_key={402}/leagues');
  res.status(200).send(response.data)
}
)

app.get('/extractPlayers/:league_keyposition', async (request, res) => {
  const league_key_position = request.params.league_keyposition.split(',');
  const league_key = league_key_position[0];
  const position_str = league_key_position[1] ? `;position=${league_key_position[1].toUpperCase()}` : '';
  console.log(position_str)
  console.log(league_key)
  let team_key;
  const response = await makeAPIrequest('https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nba/teams')

  parseString(response.data, function (err, result) {
    const games = result.fantasy_content.users[0].user[0].games[0].game;

    for (let i = 0; i < games.length; i++) {
      console.log(games[i].teams[0].team[0].team_key[0])
      if (games[i].teams[0].team[0].team_key[0].includes(league_key)) {
        team_key = games[i].teams[0].team[0].team_key[0];
      }
    }
  });

  const matchup_response = await makeAPIrequest(`https://fantasysports.yahooapis.com/fantasy/v2/team/${team_key}/matchups;weeks=11`)
  parseMatchup(matchup_response.data)

  function Team() {
    this.name = '',
    this.team_key = '',
    this.stats = [];
  }

  async function parseMatchup(data) {

    let team1 = new Team()
    let team2 = new Team()
    let matchup_diff = {}

    parseString(data, function (err, result) {
      teams_data = result.fantasy_content.team[0].matchups[0].matchup[0].teams[0];
      team1.name = teams_data.team[0].name[0]
      team1.team_key = teams_data.team[0].team_key[0]
      team2.name = teams_data.team[1].name[0]
      team2.team_key = teams_data.team[1].team_key[0]
      team1_stats = teams_data.team[0].team_stats[0].stats;
      team2_stats = teams_data.team[1].team_stats[0].stats;
      for (let i = 0; i < team1_stats[0].stat.length; i++) {
        team1.stats.push(team1_stats[0].stat[i])
        team2.stats.push(team2_stats[0].stat[i])
      }
    });

    for (let i = 4; i < 11; i++) {
        matchup_diff[team1.stats[i].stat_id] = Math.abs(team1.stats[i].value - team2.stats[i].value);
    }

    let entries = Object.entries(matchup_diff);
    let sorted = entries.sort((a, b) => a[1] - b[1]);

    getPlayerPickups(sorted)

  }
  async function getPlayerPickups(data) {
    const stat_id = data[0][0]
    let player_obj;
    const topPlayerData = await makeAPIrequest(`https://fantasysports.yahooapis.com/fantasy/v2/league/${league_key}/players;status=A;sort=${stat_id};sort_type=lastmonth;count=5${position_str}`)
    parseString(topPlayerData.data, function (err, result) {
      console.log(result.fantasy_content.league[0].players)
      player_obj = result.fantasy_content.league[0].players[0].player;
      res.status(200).send(player_obj)
    });
  }
}
)

const port = 5000;

app.listen(port, () => {
  console.log(`Server running at port ${port}`);
});

