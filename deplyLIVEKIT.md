Setting Up Your LiveKit Server: A Comprehensive Guide
This guide provides a step-by-step walkthrough for deploying a self-hosted LiveKit server. The recommended and most straightforward method involves using LiveKit's official Docker-based configuration generator, which simplifies the setup process, including the embedded TURN server for better connectivity and automatic SSL certificate provisioning.

Prerequisites
Before you begin, ensure you have the following:

A domain name you own. You will need to create subdomains for your LiveKit server.[1]
A Linux server (Virtual Machine) with a public IP address. Cloud providers like AWS, Google Cloud, DigitalOcean, and Linode are all suitable options.[2]
The ability to add DNS records for your domain.[2]
Docker and Docker Compose installed on your server. The setup script provided by LiveKit will handle this installation for you.[2]

Install Docker and Docker Compose (if not already installed)
First, update your system packages, then install Docker:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt-get install ca-certificates curl gnupg -y
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
```
Step 1: Generate Configuration Files
LiveKit offers a convenient Docker-based tool to generate all the necessary configuration files for your server.[2] This should be run from your local machine, not the server you intend to deploy to.

Pull the generation tool Docker image:
```bash
docker pull livekit/generate
```
Run the configuration generator:
```bash
docker run --rm -it -v$PWD:/output livekit/generate
```
This will launch an interactive setup process. You will be prompted for the following information:[3][4]

Primary domain name: Enter the subdomain you'll use for LiveKit (e.g., livekit.your-domain.com).[4][5]
TURN server domain name: Enter a separate subdomain for the TURN server (e.g., turn.your-domain.com).[4][5]
SSL Certificate: Choose "Let's Encrypt (no account required)" for automatic and free SSL certificate generation.[3][4]
LiveKit Version: Select the latest version.[3][4]
Redis: Choose to use the bundled copy of Redis.[3][5]
What to deploy: Choose "with Egress" if you need recording capabilities (e.g., save recordings to S3, GCS, or stream to external services).[7]
Deployment Method: You'll be given options like "Startup Shell Script" or "Cloud Init".[6]
Cloud Init: This is the easiest option if your cloud provider supports it (like AWS, Azure, Digital Ocean). It generates a cloud-init.xxxx.yaml file.[2]
Startup Shell Script: This generates an init_script.sh file that can be used on any Linux VM.[2]
Once you complete the prompts, a new directory named after your primary domain will be created on your local machine. This folder will contain all the necessary configuration files, including docker-compose.yaml, livekit.yaml, caddy.yaml, and your chosen deployment script (init_script.sh or cloud_init.xxxx.yaml).[2] You will also be provided with your API Key and Secret; be sure to save these in a secure location.[3][5]

Step 2: DNS Configuration
You now need to point the subdomains you specified during the configuration generation to your server's public IP address. Create two "A" records in your domain's DNS settings:

One for your primary LiveKit domain (e.g., livekit.your-domain.com).
One for your TURN server domain (e.g., turn.your-domain.com).
Both should point to the same public IP address of your server.

Step 3: Firewall Configuration
For LiveKit to function correctly, you need to open specific ports on your server's firewall. The required ports will be listed in the output of the configuration generator.[3] Typically, these include:

TCP 80: For the initial SSL certificate challenge.[3]
TCP 443: For the primary HTTPS and TURN/TLS connections.[3]
TCP 7881: For WebRTC over TCP.[3]
UDP 3478: For TURN over UDP.[3]
UDP 50000-60000: For WebRTC over UDP.[3]
If you are using a firewall like UFW (Uncomplicated Firewall) on Ubuntu, you can open these ports with commands like:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 3478/udp
sudo ufw allow 50000:60000/udp
sudo ufw enable
```
Step 4: Deploy to Your Server
Now it's time to move the configuration to your server and start LiveKit.

Method A: Using cloud-init (if supported)

When launching a new VM on a supported cloud provider, find the "User data" field.
Copy the entire content of the cloud-init.xxxx.yaml file and paste it into the "User data" field.
Launch the VM. LiveKit will be installed and started automatically as the machine boots up.[2]
Method B: Using the Startup Shell Script

Copy the generated init_script.sh file from your local machine to your server. You can use a tool like scp for this.
SSH into your server.
Make the script executable:[5]
```bash
sudo chmod +x init_script.sh
```
Run the script:[5]
```bash
sudo ./init_script.sh
```
This script will install Docker and Docker Compose, and then set up LiveKit as a systemd service to run in the background.[2]

Step 5: Verify the Installation
The installation process might take a few minutes. You can check the status of the LiveKit service with the following command:[3]

```bash
sudo systemctl status livekit-docker
```
Once everything is up and running, you can visit your LiveKit domain in a web browser (e.g., https://livekit.your-domain.com). You should see an "OK" message, indicating a successful deployment.[4]

You can now use the API Key and Secret you saved earlier to connect your applications to your new self-hosted LiveKit server.
Sources