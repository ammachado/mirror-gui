# Spike: serves the prebuilt bundle (npm run build) behind the nginx config in deploy/plugin.yaml.
FROM registry.access.redhat.com/ubi9/nginx-124
COPY dist /usr/share/nginx/html
USER 1001
CMD ["nginx", "-g", "daemon off;"]
