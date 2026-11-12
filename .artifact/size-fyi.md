---
title: size.fyi
date: 2026-07
category: product
tags: [web]
url: https://size.fyi
links:
  source: https://github.com/arfct/size.fyi
media:
  - src: comparison.png
    caption: An iPhone 18 Pro, an open Galaxy Z Fold8 and the banana in a row, smallest first, with each object's dimensions in millimetres listed at the left
    alt: A web page with a list of three items at the left and a 3D grid holding a blue phone, a wider orange folding phone and a yellow wireframe banana standing side by side
  - src: front.png
    caption: The same three in the front view, where the banana's 190 mm is the longest edge on the page
    alt: A flat front-on drawing of a blue phone outline, an orange folding phone outline and a yellow wireframe banana on a pale grid, each labelled with its width and height
  - src: stacked.png
    caption: The stacked layout, with the phone in front and the banana behind
    alt: A 3D grid with a blue phone standing in front of an orange folding phone, and a yellow wireframe banana partly hidden behind both
icon_shape: none
unconfirmed: [date]
---

A banana 190 mm long is among the 132 objects that size.fyi can draw side by side in 3D, at true relative scale. It is listed as Banana for scale and drawn as a wireframe, in a yellow that no other item is given. The rest are mostly phones, tablets, laptops, consoles and watches, along with sixteen paper sizes and everyday things such as a credit card, a wine bottle and a double mattress.

The objects chosen for a comparison stand in a row, smallest first, as in the first image, or in a second layout are stacked front to back with the largest behind. The view can be turned to front, side or top, and dimensions read in metric or imperial units. A folding phone has a separate shape for each of its states. Every comparison has an address of its own, such as size.fyi/iphone-18-pro-vs-galaxy-z-fold8-open, and an address can also carry an object that is not in the catalogue, written as a name and three dimensions.

On a phone, a comparison opens in AR at real scale, through AR Quick Look on iOS and Scene Viewer on Android. Each catalogue item is a single JSON file with its dimensions in millimetres, and the public repository takes new ones by pull request or by issue.

TypeScript, React, three.js, Cloudflare Workers. 2026.
