REGISTRY  := zot.lan
IMAGE     := homereef-seaglass
TAG       := latest
NAMESPACE := kube-idle
RELEASE   := seaglass
CHART     := helm

VERSION_FILE := src/version.txt
VERSION      := $(shell cat $(VERSION_FILE) | tr -d '[:space:]')

.PHONY: build push deploy helm-upgrade lint local

build:
	@MANIFEST=$(IMAGE)-manifest:$(VERSION); \
	podman manifest rm "$$MANIFEST" 2>/dev/null || true; \
	podman buildx build \
		--platform linux/amd64,linux/arm64 \
		--manifest "$$MANIFEST" \
		-f containerfiles/Containerfile \
		.

push: build
	@MANIFEST=$(IMAGE)-manifest:$(VERSION); \
	echo "Pushing $(REGISTRY)/$(IMAGE):$(VERSION)"; \
	podman manifest push --tls-verify=false --all "$$MANIFEST" \
		"docker://$(REGISTRY)/$(IMAGE):$(VERSION)"; \
	echo "Pushing $(REGISTRY)/$(IMAGE):$(TAG)"; \
	podman manifest push --tls-verify=false --all "$$MANIFEST" \
		"docker://$(REGISTRY)/$(IMAGE):$(TAG)"

VALUES_LOCAL := $(wildcard helm/values.local.yaml)

helm-upgrade:
	helm upgrade --install $(RELEASE) $(CHART) \
		--namespace $(NAMESPACE) \
		--create-namespace \
		$(if $(VALUES_LOCAL),-f $(VALUES_LOCAL)) \
		--set appVersion=$(VERSION)

deploy: push helm-upgrade
	kubectl rollout restart deployment/$(RELEASE) -n $(NAMESPACE)
	kubectl rollout status deployment/$(RELEASE) -n $(NAMESPACE)

lint:
	helm lint $(CHART)

local:
	podman-compose -f containerfiles/local-test-seaglass.yml up --build
