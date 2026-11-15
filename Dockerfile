FROM node:24-bookworm-slim AS ocr
WORKDIR /app
COPY package.json package-lock.json stage-ocr.mjs ./
RUN npm ci --ignore-scripts --no-audit --no-fund && node stage-ocr.mjs

FROM node:24-bookworm-slim
WORKDIR /app
COPY api.mjs server.mjs ./
COPY drizzle ./drizzle
COPY public ./public
COPY --from=ocr /app/public/ocr ./public/ocr
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node","server.mjs"]
