const spotify_api = require("spotify-web-api-node");

const querystring = require('querystring');
const cookieParser = require('cookie-parser');

const express = require("express");
const app = express();
const http = require("http").Server(app);
const io = require("socket.io")(http);

const path = require("path");
const config = require(path.join(__dirname, "config"));

const bci_process = require(path.join(__dirname, "bci-processing"));
bci_process.setup(config);
var limits = [
	[-100, 100],
	[-100, 100]
];

// Set up spotify
const scope = 'streaming user-read-birthdate user-read-email user-read-private playlist-modify-private';
const stateKey = "__MEDUSA_COOKIE__";
let spotify = new spotify_api({
	clientId: config.spotify.ID,
	clientSecret: config.spotify.SECRET,
	redirectUri: config.spotify.REDIRECT
});

let playlists = [];
let cache = [];
let global_next = null;
let offset = {position: 0};
let player_id = null;

// Set up web server
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());
app.get("/", (req, res) => {
	if (spotify.__isReady)
		res.sendFile(path.join(__dirname, "index.html"));
	else
		res.redirect("/login");
});
app.get("/login", (req, res) => {
	let state = Math.random().toString(36).substring(0, 15);
	res.cookie(stateKey, state);

	res.redirect('https://accounts.spotify.com/authorize?' + 
		querystring.stringify({
			response_type: "code",
			client_id: config.spotify.ID,
			scope: scope,
			redirect_uri: config.spotify.REDIRECT,
			state: state
		})
	);
});
app.get("/callback", (req, res) => {
	let code = req.query.code || null;
	let state = req.query.state || null;
	let storedState = req.cookies ? req.cookies[stateKey] : null;

	if (state === null || state !== storedState) {
		res.redirect('/#' +
			querystring.stringify({
				error: 'state_mismatch'
			})
		);
	} else {
		res.clearCookie(stateKey);
		spotify.authorizationCodeGrant(code).then((data) => {
			spotify.setAccessToken(data.body['access_token']);
			spotify.setRefreshToken(data.body['refresh_token']);

			spotify.__isReady = true;

			res.redirect("/");
		}, function (err) {
			console.log("Error getting code: ", err);
		});
	}
});
app.use((req, res) => {
	res.status(404).send("Error 404: Not found");
});

// Set up socket.io
let user_id = null, myPlaylist = {}, nextHandler, bci_data;
io.on("connection", (socket) => {
	console.log("User connected");

	if (spotify.__isReady) {
		socket.emit("token", spotify.getAccessToken());

		// BCI information
		let sendWait = 0;
		bci_process.setCallback((res) => {
			if (res.valence > limits[0][0]) limits[0][0] = res.valence;
			if (res.valence < limits[0][1]) limits[0][1] = res.valence;
			if (res.arousal > limits[1][0]) limits[1][0] = res.arousal;
			if (res.arousal < limits[1][1]) limits[1][1] = res.arousal;

			if (++sendWait == 10) {
				bci_data = {
					valence: Math.abs(res.valence - limits[0][1]) / Math.abs(limits[0][0] - limits[0][1]),
					arousal: Math.abs(res.arousal - limits[1][1]) / Math.abs(limits[1][0] - limits[1][1])
				};
				socket.emit("bci", bci_data);

				sendWait = 0;
			}
		});

		// Create playlist for this session
		if (!user_id) {
			spotify.getMe().then(data => {
				user_id = data.body.id;

				spotify.createPlaylist(user_id, "MEDUSA-" + new Date(), {public: false}).then(data => {
					myPlaylist.id  = data.body.id;
					myPlaylist.uri = data.body.uri;
				}, err => {
					console.error("CREATE_ERROR: ", err);
				});
			});
		}

		socket.on("id", id => {
			player_id = id;
		});

		let playing = false;
		socket.on("toggle", () => {
			console.log("PLAY_STATE: ", playing, ":", player_id);
			if (playing) {
				spotify.pause({device_id: player_id}).then(data => {
					console.log("Stopped");
					offset = {position: offset.position - 1};
				}, err => {
					console.error("PAUSE_ERROR: ", err);
				});
			} else {
				if (!cache || cache.length == 0) {
					refresh_cache(() => queue(() => play()));
				} else {
					play();
				}
			}
		});

		socket.on("playing", state => {
			// Just started playing, get ready to queue
			if (!playing && state) {
				console.log("QUEUE TIMEOUT:", global_next, ":", Math.floor(global_next.duration_ms * 0.9));
				setTimeout(queue, Math.floor(global_next.duration_ms * 0.85));
				setTimeout(() => {play(); socket.emit("target", global_next);}, global_next.duration_ms + 10);

				socket.emit("target", global_next);
			}

			playing = state;
		});
	}
})

http.listen(config.http.PORT, config.http.HOST, () => {
	console.log("Server running on: " + config.http.HOST + ":" + config.http.PORT);
});

function play(cb) {
	spotify.play({device_id: player_id, context_uri: myPlaylist.uri, offset: offset}).then(data => {
		console.log("PLAYING: ", offset);
		offset = {position: offset.position + 1};

		if (cb) cb();
	}, err => {
		console.error("PLAY_ERROR: ", err);
	});
}

function consume_track(cb) {
	cache = cache.filter(x => {
		let threshold = {
			valence: Math.min(0.5, bci_data.valence),
			arousal: Math.max(0.5, bci_data.arousal)
		};

		return (x.valence > threshold.valence && x.arousal < threshold.arousal);
	});

	if (cache.length > 0) {
		global_next = cache.splice(Math.floor(Math.random() * cache.length), 1)[0];
		cb(global_next);
	} else {
		console.log("CACHE EMPTY...");
		refresh_cache(() => {
			console.log("CACHE NO LONGER EMPTY");
			consume_track(cb);
		});
	}
}

function queue(cb) {
	consume_track((next) => {
		spotify.addTracksToPlaylist(user_id, myPlaylist.id, [next.uri]).then(data => {
			console.log("NEXT SONG QUEUED...");

			if (cb) cb();
		}, err => console.error("QUEUE ERR: ", err));
	});
}

function _refresh(pl, cb) {
	spotify.getPlaylistTracks(pl.user, pl.id).then(data => {
		cache = cache.concat(uniq(data.body.items.map(x => {
			return {
				id: x.track.id,
				uri: x.track.uri,
				image_url: x.track.album.images[0].url,
				duration_ms: x.track.duration_ms,
				name: x.track.name,
				album: x.track.album.name,
				artist: x.track.album.artists[0].name
			};
		})));

		let temp = cache.map(x => x.id);
		spotify.getAudioFeaturesForTracks(temp).then(data => {
			cache = cache.map((x, index) => {
				return {
					id: x.id,
					uri: x.uri,
					image_url: x.image_url,
					arousal: data.body.audio_features[index].energy,
					valence: data.body.audio_features[index].valence,
					duration_ms: x.duration_ms,
					name: x.name,
					album: x.album,
					artist: x.artist
				};
			});

			if (cb) {
				cb();
			}
		});
	});
}

function refresh_cache(cb) {
	if (playlists.length > 0) {
		_refresh(playlists.splice(Math.floor(Math.random() * playlists.length), 1)[0], cb);
	} else {
		spotify.searchPlaylists('instrumental')
		.then(data => {
			playlists = data.body.playlists.items.map(x => { return {user: x.owner.id, id: x.id} });
			_refresh(playlists.splice(Math.floor(Math.random() * playlists.length), 1)[0], cb);
		}, err => {
			console.log('Something went wrong!', err);
		});
	}
}

function uniq(a) {
	var seen = {};
	return a.filter(function(item) {
		return seen.hasOwnProperty(item.id) ? false : (seen[item.id] = true);
	});
}