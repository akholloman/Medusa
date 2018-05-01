import _pickle
import pandas as pd

if __name__ == "__main__":
	for x in range(1, 33):
		f = _pickle.load(open('test/data_preprocessed_python/s%02d.dat' % x, 'rb'), encoding="latin1")
		
		with open('test/data/s%02d.json' % x, 'w') as file:
			file.write(pd.Series(f).to_json(orient='values'))