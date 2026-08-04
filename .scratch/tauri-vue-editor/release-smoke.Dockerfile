FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      dbus-x11 \
      file \
      imagemagick \
      libgtk-3-0 \
      libwebkit2gtk-4.1-0 \
      openbox \
      xdotool \
      xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /smoke
