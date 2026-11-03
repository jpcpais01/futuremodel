.PHONY: install update train backtest signal reconcile demo test

install:
	pip install -e ".[news,dev]"
update:
	fm update
train:
	fm train
backtest:
	fm backtest
signal:
	fm signal
reconcile:
	fm reconcile
demo:
	fm demo
test:
	python -m pytest -q
