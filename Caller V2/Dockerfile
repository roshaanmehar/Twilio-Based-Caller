# Use an official lightweight Node.js image
FROM node:18-slim

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to install dependencies
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of your application code
COPY . .

# Tell Cloud Run what command to use to start your server
CMD [ "node", "server.js" ]