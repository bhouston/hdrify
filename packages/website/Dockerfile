# The documentation and demo now live on GitHub Pages. Keep existing links,
# including ?image= links from the editor extension, working at the old domain.
FROM node:26-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY packages/website/scripts/redirect-server.mjs ./redirect-server.mjs
EXPOSE 8080
CMD ["node", "redirect-server.mjs"]
