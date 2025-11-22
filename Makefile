.PHONY: build clean

build:
	@echo "Building frontend..."
	cd frontend && npm install && npm run build
	@echo "Linting frontend..."
	cd frontend && npm run lint
	@echo "Building backend..."
	go build -o differing .
	@echo "Build complete! Run ./differing to start the application."

clean:
	@echo "Cleaning build artifacts..."
	rm -rf frontend/dist
	rm -f differing
	@echo "Clean complete"
