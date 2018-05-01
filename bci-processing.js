const osc = require("node-osc");

let cb = () => {};

const WEIGHT = 0.97;
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

let results = {
	valence: 0,
	arousal: 0
};

let map = (id) => {
	switch (id) {
		case 0: return "f7";
		case 1: return "f8";
		case 2: return "af3";
		case 3: return "af4";
		default: throw new Error("Invalid ID " + id);
	}
};

let series = (arr, _m, _t) => {
	return arr.filter((cur, index) => {
		return (index - _m) % _t == 0;
	});
}

function _setCallback(_cb) {
	cb = _cb;
}

// Assuming sample is prepended with the OSC namespace. Hence the shift at the beginning
function _analyzeSample(sample) {
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
			sliding[channel].fd = Math.log(avg) / (-1 * Math.log(t));
		}
	});

	results.valence = results.valence * WEIGHT + 
		(((sliding.af4.fd - sliding.af3.fd) + (sliding.f8.fd - sliding.f7.fd)) / 2.0) * (1.0 - WEIGHT);
	results.arousal = results.arousal * WEIGHT +
		((sliding.af3.fd + sliding.af4.fd + sliding.f7.fd + sliding.f8.fd) / 4.0) * (1.0 - WEIGHT);

	return results;
};

module.exports = {
	setup: (config) => {
		// Set up OSC server
		let server = new osc.Server(config.osc.PORT, config.osc.HOST);
		server.on("/openbci", (sample, rinfo) => {
			cb(module.exports.analyzeSample(sample));
		});
	},
	analyzeSample: (sample) => {
		return _analyzeSample(sample);
	},
	setCallback: (cb) => {
		_setCallback(cb);
	}
};