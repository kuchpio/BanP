.PHONY: wasm

wasm: smartban-lib/src/*
	wasm-pack build --target web -d ../smartban-front/pkg ./smartban-lib/