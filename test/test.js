const path = require("path");
const fs = require("fs");

const bci_process = require(path.join(__dirname, "..", "bci-processing.js"));

let overall_error = [];
for (var _ = 1; _ < 33; ++_) {
	fs.readFile(path.join(__dirname, "data", "s" + (_ < 10 ? "0" + _ : _) + ".json"), {
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
		for (var el in eeg) {
			var c = [];
			for (var i = 0; i < eeg[el]["f7"].length; ++i) {
				c.push([
					"/openbci",
					eeg[el]["f7"][i],
					eeg[el]["f8"][i],
					eeg[el]["af3"][i],
					eeg[el]["af4"][i]
				]);
			}

			samples.push(c);
		}

		let results = json[1].map(x => {
			return {valence: x[0] / 9.0, arousal: x[1] / 9.0};
		});

		var final = [];
		var errors = [];
		for (var index in samples) {
			var limits = [
				[-100, 100],
				[-100, 100]
			];
			for (var subindex in samples[index]) {
				var res = bci_process.analyzeSample(samples[index][subindex]);

				if (res.valence > limits[0][0]) limits[0][0] = res.valence;
				if (res.valence < limits[0][1]) limits[0][1] = res.valence;
				if (res.arousal > limits[1][0]) limits[1][0] = res.arousal;
				if (res.arousal < limits[1][1]) limits[1][1] = res.arousal;

				if (subindex == samples[index].length - 1) {
					final.push({
						valence: Math.abs(res.valence - limits[0][1]) / Math.abs(limits[0][0] - limits[0][1]),
						arousal: Math.abs(res.arousal - limits[1][1]) / Math.abs(limits[1][0] - limits[1][1])
					});

					errors.push({
						valence: Math.abs(final[index].valence - results[index].valence) / results[index].valence,
						arousal: Math.abs(final[index].arousal - results[index].arousal) / results[index].arousal
					});

					// console.log("RES (", index, "): ", final[index], "|", results[index]);
					// console.log("ERROR: ", errors[index].valence, "(V) |", errors[index].arousal, "(A)");
				}
			}
		}

		let error_avg = {
			valence: errors.reduce((acc, cur) => acc + cur.valence, 0) / errors.length,
			arousal: errors.reduce((acc, cur) => acc + cur.arousal, 0) / errors.length
		};

		console.log("AVERAGE ERROR:", error_avg.valence, "(V) |", error_avg.arousal, "(A)");
		overall_error.push(error_avg);

		done();
	});
}

var count = 0;
function done() {
	if (++count > 31) {
		console.log("-------------------------");
		console.log("OVERALL ERROR:",
			overall_error.reduce((acc, cur) => acc + cur.valence, 0) / overall_error.length, "(V)",
			overall_error.reduce((acc, cur) => acc + cur.arousal, 0) / overall_error.length, "(A)"
		);
	}
}