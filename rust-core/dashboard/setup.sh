#!/bin/bash

# Phase 5 Dashboard Setup Script

echo "Setting up Phase 5 Dashboard..."

# Fix npm permissions if needed
if [ -d "$HOME/.npm" ]; then
    echo "Fixing npm cache permissions..."
    sudo chown -R $(whoami) "$HOME/.npm"
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Create .env.local
if [ ! -f .env.local ]; then
    echo "Creating .env.local file..."
    cp .env.local.example .env.local
fi

# Create docs directory
mkdir -p docs/screenshots

echo ""
echo "Setup complete! 🚀"
echo ""
echo "To start the development server:"
echo "  npm run dev"
echo ""
echo "To build for production:"
echo "  npm run build"
echo "  npm start"
echo ""
echo "To run with Docker:"
echo "  docker-compose -f ../docker-compose.dashboard.yml up -d"
echo ""
