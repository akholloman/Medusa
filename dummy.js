const path = require("path");
const fs = require("fs");
const osc = require("node-osc");

fs.readFile(path.join(__dirname, "test", "data", "s02.json"), {
	encoding: "latin1"
}, (err, data) => {
	let json = JSON.parse(data);

	let eeg = json[0].map(x => {
		return {
			"f7": x[3],
			"f8": x[20],
			"af3": x[1],
			"af4": x[17]
		}
	});

	let samples = [];
	for (var i = 0; i < eeg[0]["f7"].length; ++i) {
		samples.push([
			eeg[0]["f7"][i],
			eeg[0]["f8"][i],
			eeg[0]["af3"][i],
			eeg[0]["af4"][i]
		]);
	}

	var client = new osc.Client('127.0.0.1', 12345);
	send(client, samples);
});

const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));
async function send(client, samples) {
	while (true) {
		for (var i in samples) {
			client.send('/openbci', samples[i], () => {});
			await snooze(10);
		}
	}
}