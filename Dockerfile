FROM node

RUN apt-get update -y \
    && apt-get -y install xvfb \
    && apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
        libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
        libxrandr2 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

WORKDIR /app

COPY package.json /app/package.json

RUN npm install

COPY src /app/src

CMD xvfb-run --auto-servernum node src/app.js



