set shell := ["bash", "-cu"]

default:
    @just --list

# Run headless Node.js unit tests on 96-square topology and Rosette rules
test:
    node --test tests/*.test.mjs

# Serve TriBecca locally on http://localhost:8080
serve port="8080":
    python3 -m http.server {{port}}

# Build verification (static ES modules + unit tests)
build: test
    @echo "✅ TriBecca v$(cat VERSION) ready for GitHub Pages!"

# Deploy / trigger GitHub Pages build
deploy: build
    git push origin main
    gh api -X POST repos/palladius/tribecca/pages/builds || true
