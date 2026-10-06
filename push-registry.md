<!--docker login ghcr.io-->
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.2"
node scripts/publish-control-plane-images.mjs
