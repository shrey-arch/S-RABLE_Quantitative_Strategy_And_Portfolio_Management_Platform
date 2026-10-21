# The strategy sandbox image (Feature 6).
#
# Build it from the backend folder, once:
#   docker build -t srable-strategy-runner:1 -f app/sandbox/Dockerfile app/sandbox
#
# It holds Python plus pinned numpy and pandas and nothing else: no app code, no
# database driver, no network tools. The container is started read-only, with no
# network, no capabilities and a memory and CPU cap (see app/sandbox/runner.py),
# and runs as the unprivileged "nobody" user.
FROM python:3.13-slim

# Pinned so a replayed run computes the same numbers as the backend's own.
RUN pip install --no-cache-dir numpy==2.5.4 pandas==3.0.6 \
    && find /usr/local -name '*.pyc' -delete \
    && rm -rf /root/.cache

# Only the two sandbox files. guard.py is stdlib-only and imports nothing of the app.
WORKDIR /sandbox
COPY child.py guard.py /sandbox/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONHASHSEED=0 \
    PYTHONNOUSERSITE=1 \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    TZ=UTC

USER 65534:65534
ENTRYPOINT []
CMD ["python", "-s", "-B", "-E", "/sandbox/child.py"]
