name: Deploy to Production
on:
  push:
    branches:
      - main

jobs:
  deploy:
    name: Deploy Docker Compose to Server
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Set up SSH Agent
        uses: webfactory/ssh-agent@v0.7.0
        with:
          ssh-private-key: ${{ secrets.DEPLOY_KEY }}

      - name: Deploy to Server
        env:
          DOCKER_HOST: "ssh://ubuntu@ml4paleo.labs.bossdb.org"
        run: |
          cd ~/bossypaints && git pull origin main && docker-compose up -d --build
