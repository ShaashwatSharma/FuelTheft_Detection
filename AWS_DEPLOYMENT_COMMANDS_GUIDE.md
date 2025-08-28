# 🚀 AWS Deployment Commands Guide
## Fuel Theft Detection Backend - Complete Command Reference

### 📋 Table of Contents
1. [Initial Server Setup](#initial-server-setup)
2. [Docker Installation](#docker-installation)
3. [Application Deployment](#application-deployment)
4. [Database Setup](#database-setup)
5. [Prisma Studio Access](#prisma-studio-access)
6. [Troubleshooting](#troubleshooting)
7. [Security Configuration](#security-configuration)

---

## 🏗️ Initial Server Setup

### **Connect to AWS Instance**
```bash
ssh -i /path/to/your-key.pem ec2-user@YOUR_IP_ADDRESS
```
**Description:** Establishes SSH connection to your AWS EC2 instance using your private key file.

### **Update System Packages**
```bash
sudo yum update -y
```
**Description:** Updates all system packages to latest versions for security and compatibility.

### **Install Essential Tools**
```bash
sudo yum install -y git curl wget unzip
```
**Description:** Installs basic tools needed for development and deployment.

---

## 🐳 Docker Installation

### **Install Docker**
```bash
# Install Docker
sudo yum install -y docker

# Start Docker service
sudo systemctl start docker

# Enable Docker to start on boot
sudo systemctl enable docker

# Add ec2-user to docker group
sudo usermod -a -G docker ec2-user

# Logout and login again for group changes to take effect
exit
# Reconnect via SSH
```
**Description:** Installs Docker containerization platform and configures it to run automatically.

### **Install Docker Compose**
```bash
# Download Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# Make it executable
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker-compose --version
```
**Description:** Installs Docker Compose for managing multi-container applications.

---

## 📦 Application Deployment

### **Clone Repository**
```bash
git clone https://github.com/your-repo/FuelTheft_Detection.git
cd FuelTheft_Detection
```
**Description:** Downloads your application code from Git repository.

### **Transfer AWS IoT Certificates**
```bash
# From your local machine (not AWS)
scp -r -i /path/to/your-key.pem cert/ ec2-user@YOUR_IP_ADDRESS:~/FuelTheft_Detection/

# Verify transfer on AWS instance
ls -la cert/
ls -la cert/thing1/
ls -la cert/thing2/
ls -la cert/thing3/
ls -la cert/thing4/
ls -la cert/thing5/

# Set proper permissions (for files with hash prefixes)
find cert/ -name '*-certificate.pem.crt' -exec chmod 600 {} \;
find cert/ -name '*-private.pem.key' -exec chmod 600 {} \;
find cert/ -name 'AmazonRootCA1.pem' -exec chmod 644 {} \;
```
**Description:** Transfers AWS IoT certificates for MQTT authentication and sets proper file permissions.

### **Create Environment File**
```bash
# Create docker.env file
cat > docker.env << EOF
DATABASE_URL="postgresql://fueladmin:mysecretpassword@postgres:5432/fueltheftdb"
AWS_IOT_ENDPOINT="your-aws-iot-endpoint.amazonaws.com"
AWS_REGION="us-east-1"
NODE_ENV="production"
EOF
```
**Description:** Creates environment configuration file with database and AWS IoT settings.

### **Add Swap Space (For Low Memory Instances)**
```bash
# Create 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make swap permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
**Description:** Creates virtual memory to prevent out-of-memory errors on small instances.

### **Build and Start Application**
```bash
# Build Docker images
docker-compose build

# Start all services
docker-compose up -d

# Check service status
docker-compose ps
```
**Description:** Builds application containers and starts all services in background mode.

---

## 🗄️ Database Setup

### **Generate Prisma Client**
```bash
docker-compose exec backend npx prisma generate
```
**Description:** Generates TypeScript client for database operations.

### **Run Database Migrations**
```bash
# For development (creates shadow database)
docker-compose exec backend npx prisma migrate dev

# For production (applies existing migrations)
docker-compose exec backend npx prisma migrate deploy
```
**Description:** Applies database schema changes and creates tables.

### **Seed Initial Data (Optional)**
```bash
docker-compose exec backend npm run seed
```
**Description:** Populates database with initial test data.

---

## 🔧 Prisma Studio Access

### **Start Prisma Studio**
```bash
# Start on port 5555 (exposed in docker-compose)
docker-compose exec -d backend npx prisma studio --port 5555

# Check if it's running
docker-compose exec backend netstat -tlnp | grep 5555
```
**Description:** Starts Prisma Studio database GUI for data management.

### **Access Prisma Studio from Local Machine**
```bash
# From your local Mac terminal (not AWS)
ssh -L 5555:localhost:5555 -i /path/to/your-key.pem ec2-user@YOUR_IP_ADDRESS
```
**Description:** Creates SSH tunnel to access Prisma Studio from your local browser at `http://localhost:5555`.

---

## 🔍 Troubleshooting

### **Check Service Status**
```bash
# View all containers
docker-compose ps

# View logs
docker-compose logs backend
docker-compose logs model-service
docker-compose logs postgres

# Follow logs in real-time
docker-compose logs -f backend
```
**Description:** Monitors application health and troubleshoots issues.

### **Free Up Disk Space**
```bash
# Clean Docker system
docker system prune -a --volumes -f

# Clean package cache
sudo yum clean all

# Clean journal logs
sudo journalctl --vacuum-time=1d

# Remove temporary files
sudo rm -rf /tmp/*
sudo rm -rf /var/tmp/*
```
**Description:** Removes unused Docker images, containers, and system files to free disk space.

### **Restart Services**
```bash
# Restart specific service
docker-compose restart backend

# Restart all services
docker-compose restart

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```
**Description:** Restarts services to apply configuration changes or recover from errors.

---

## 🔒 Security Configuration

### **Update AWS Security Group**
**In AWS Console:**
1. Go to EC2 → Instances → Select your instance
2. Click Security Group link
3. Add Inbound Rules:

```
Type: Custom TCP
Port: 3000
Source: 0.0.0.0/0 (or specific IP)
Description: Backend API

Type: Custom TCP  
Port: 5001
Source: 0.0.0.0/0 (or specific IP)
Description: ML Model API

Type: Custom TCP
Port: 5555
Source: 0.0.0.0/0 (or specific IP)  
Description: Prisma Studio
```
**Description:** Opens necessary ports for external access to your application.

### **Test External Access**
```bash
# Test backend API
curl -I http://YOUR_IP_ADDRESS:3000/health

# Test ML model
curl -I http://YOUR_IP_ADDRESS:5001/health
```
**Description:** Verifies that services are accessible from external networks.

---

## 📊 Monitoring Commands

### **Check Resource Usage**
```bash
# Check disk usage
df -h

# Check memory usage
free -h

# Check Docker resource usage
docker system df

# Check running processes
ps aux | grep node
```
**Description:** Monitors system resources and application performance.

### **Check Network Connections**
```bash
# Check listening ports
netstat -tlnp

# Check Docker port mappings
docker port $(docker-compose ps -q backend)
```
**Description:** Verifies network connectivity and port exposure.

---

## 🚀 Production Deployment Checklist

### **Pre-Deployment**
- [ ] AWS instance created and accessible
- [ ] Security groups configured
- [ ] Environment variables set
- [ ] SSL certificate obtained (for HTTPS)

### **Deployment**
- [ ] Docker and Docker Compose installed
- [ ] Application code deployed
- [ ] Database migrations applied
- [ ] Services started and healthy
- [ ] External access verified

### **Post-Deployment**
- [ ] Monitor application logs
- [ ] Test all API endpoints
- [ ] Configure monitoring/alerting
- [ ] Set up backup strategy
- [ ] Document deployment process

---

## 🎯 Quick Reference Commands

### **Essential Commands**
```bash
# Start application
docker-compose up -d

# Stop application  
docker-compose down

# View logs
docker-compose logs -f

# Restart backend
docker-compose restart backend

# Access database
docker-compose exec backend npx prisma studio --port 5555
```

### **Troubleshooting Commands**
```bash
# Check disk space
df -h

# Clean Docker
docker system prune -a --volumes -f

# Check service health
docker-compose ps

# View recent logs
docker-compose logs --tail=50 backend
```

---

## 📝 Notes

- **Backup your data** before running migrations
- **Monitor disk space** regularly on small instances
- **Use HTTPS** in production for security
- **Set up monitoring** for production deployments
- **Keep Docker images updated** for security patches

---

**🎉 Your Fuel Theft Detection Backend is now deployed and ready!**

**API Endpoint:** `http://YOUR_IP_ADDRESS:3000`  
**Prisma Studio:** `http://localhost:5555` (via SSH tunnel)  
**Health Check:** `http://YOUR_IP_ADDRESS:3000/health`
