REGISTRY  := zot.lan
IMAGE     := homereef-seaglass
TAG       := latest
NAMESPACE := kube-idle

VERSION_FILE := src/version.txt

.PHONY: build push deploy

build:
	@VERSION=$$(cat $(VERSION_FILE) | tr -d '[:space:]'); \
	MANIFEST=$(IMAGE)-manifest:$$VERSION; \
	podman manifest rm "$$MANIFEST" 2>/dev/null || true; \
	podman buildx build \
		--build-arg CACHE_BUST=$$(date +%s) \
		--platform linux/amd64,linux/arm64 \
		--manifest "$$MANIFEST" \
		-f containerfiles/Containerfile \
		.

push: build
	@VERSION=$$(cat $(VERSION_FILE) | tr -d '[:space:]'); \
	MANIFEST=$(IMAGE)-manifest:$$VERSION; \
	echo "Pushing $(REGISTRY)/$(IMAGE):$$VERSION"; \
	podman manifest push --tls-verify=false --all "$$MANIFEST" \
		"docker://$(REGISTRY)/$(IMAGE):$$VERSION"; \
	echo "Pushing $(REGISTRY)/$(IMAGE):$(TAG)"; \
	podman manifest push --tls-verify=false --all "$$MANIFEST" \
		"docker://$(REGISTRY)/$(IMAGE):$(TAG)"

deploy: push
	kubectl rollout restart deployment/seaglass -n $(NAMESPACE)
	kubectl rollout status deployment/seaglass -n $(NAMESPACE)
