const osc = require("node-osc");
const spotify_api = require("spotify-web-api-node");

const querystring = require('querystring');
const cookieParser = require('cookie-parser');

const express = require("express");
const app = express();
const http = require("http").Server(app);
const io = require("socket.io")(http);

const path = require("path");
const config = require(path.join(__dirname, "config"));

// Set up OSC server
let server = new osc.Server(config.osc.PORT, config.osc.HOST);
const N = 512.0;
const rate = 250.0;
const k = 1.0 / rate;
const t = 10;
let sliding = {
	f7: {
		fd: 0,
		lm: [],
		raw: []
	},
	f8: {
		fd: 0,
		lm: [],
		raw: []
	},
	af3: {
		fd: 0,
		lm: [],
		raw: []
	},
	af4: {
		fd: 0,
		lm: [],
		raw: []
	},
};
let map = (id) => {
	switch (id) {
		case 0: return "f7";
		case 1: return "f8";
		case 2: return "af3";
		case 3: return "af4";
		default: throw new Error("wtf " + id);
	}
};
let series = (arr, _m, _t) => {
	return arr.filter((cur, index) => {
		return (index - _m) % _t == 0;
	});
}
server.on("/openbci", (sample, rinfo) => {
	sample.shift();
	sample.forEach((element, index) => {
		let channel = map(index);
		sliding[channel].raw.push(element);

		if (sliding[channel].raw.length > N) {
			// Slide the window
			sliding[channel].raw.shift();

			// Get the L_m
			sliding[channel].lm = [];
			for (var _m = 0; _m < t - 1; ++_m) {
				let s = series(sliding[channel].raw, _m, t);
				
				sliding[channel].lm.push(
					((s.reduce((acc, cur, ind) => {
						if (ind === 0) return 0;

						return acc + Math.abs(cur - s[ind - 1])
					})) * ((N - 1) / (((N - _m) / k) * k))) / k
				);
			}

			let avg = sliding[channel].lm.reduce((acc, cur) => acc + cur) / sliding[channel].lm.length;
			sliding[channel].fd = Math.log(avg) / -1 * Math.log(t);
		}
	});
});

// Set up spotify
const scopes = ['playlist-modify-private'];
const stateKey = "__THIS IS THE COOKIE__";
let spotify = new spotify_api({
	clientId: config.spotify.ID,
	clientSecret: config.spotify.SECRET,
	redirectUri: config.spotify.REDIRECT
});

// Set up web server
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());
app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/login", (req, res) => {
	// res.redirect(authorizeURL);
	let state = Math.random().toString(36).substring(16);
	res.cookie(stateKey, state);

	res.redirect('https://accounts.spotify.com/authorize' + 
		'?response_type=code' +
		'&client_id=' + config.spotify.ID +
		(scopes ? '&scope=' + encodeURIComponent(scopes) : '') +
		'&redirect_uri=' + encodeURIComponent(config.spotify.REDIRECT));
});
app.get("/callback", (req, res) => {
	let code = req.query.code || null;
	let state = req.query.state || null;
	let storedState = req.cookies ? req.cookies[stateKey] : null;

	if (state === null || state !== storedState) {
		res.redirect('/#' +
		  querystring.stringify({
			error: 'state_mismatch'
		  }));
	} else {
		res.clearCookie(stateKey);
		spotify.authorizationCodeGrant(code).then((data) => {
			spotify.setAccessToken(data.body['access_token']);
			spotify.setRefreshToken(data.body['refresh_token']);

			res.redirect("/");
		}, function (err) {
			console.log("Error getting code: ", err);
		});
	}
	// Request an access token
	// spotify.clientCredentialsGrant()
	// .then(function(data) {
	// 	console.log('The access token expires in ' + data.body['expires_in']);
	// 	console.log('The access token is ' + data.body['access_token']);

	// 	// Save the access token so that it's used in future calls
	// 	spotify.setAccessToken(data.body['access_token']);
	// 	spotify.isReady = true;

	// 	// Generate the Playlist
	// 	spotify.createPlaylist('3lvdlxbjh4yj5ti0f34wajxry', 'MEDUSA-' + Date.now(), { 'public' : false })
	// 	.then(function(data) {
	// 		console.log(data);
	// 		console.log('Created playlist!');
	// 	}, function(err) {
	// 		console.log('Something went wrong!', err);
	// 	});

	// }, function(err) {
	// 	console.log('Something went wrong when retrieving an access token', err.message);
	// }
	// );
});
app.use((req, res) => {
	res.status(404).send("Error 404: Not found");
});

// Set up socket.io
io.on("connection", (socket) => {
	console.log("User connected");

	socket.emit("updateUnderscore", "really");
})

http.listen(config.http.PORT, config.http.HOST, () => {
	console.log("Server running on: " + config.http.HOST + ":" + config.http.PORT)
});