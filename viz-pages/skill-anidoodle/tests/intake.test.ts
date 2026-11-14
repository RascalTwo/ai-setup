// The intake builder: the one place this tour computes what it shows. A visitor picks what they want and the
// page writes the sentence to say to /anidoodle, the brief it becomes, the canvas and frame maths, and the
// commands that follow. A wrong number or a wrong flag is silent, so each choice is checked against the text
// the visitor reads.
import { describe, it, expect } from "bun:test";
import { open, brief, said, preview, commands, fill, text } from "./helpers.ts";

describe("the intake builder", () => {
  it.concurrent("should write the brief, frame maths and commands for the default story film", async () => {
    const page = await viz.given(
      "the builder on its first sight: a 45 s story film, woodcut, 16x9, 30 fps, nocturne",
      async () => open(2),
    );

    await viz.when("the visitor reads what it shows");

    await viz.then(
      "the sentence to say names the film, its length, shape, subject, style and score",
      async () => {
        expect(await said(page)).toBe(
          "“/anidoodle a 45 s 16x9 story film: a lighthouse keeper's last night, in woodcut, score: nocturne, wistful”",
        );
      },
    );
    await viz.then("the brief spells out the canvas and the sound", async () => {
      const b = await brief(page);
      expect(b).toContain("shape:  16x9 (1920x1080)");
      expect(b).toContain("length: 45 s");
      expect(b).toContain("sound:  nocturne, wistful");
    });
    await viz.then(
      "the frame maths: 45 s at 30 fps is 1,350 frames; a beat at 120 bpm is 15 frames, so 90 beats",
      async () => {
        const p = await preview(page);
        expect(p).toContain("1920 × 1080");
        expect(p).toContain("1,350 @ 30 fps");
        expect(p).toContain("15 frames (120 bpm) · 90 beats");
      },
    );
    await viz.then(
      "the film's commands carry the camel-cased name, the duration and the render/gate steps",
      async () => {
        const c = await commands(page);
        expect(c).toContain("--film aLighthouseKeepers --duration 45 --fps 30 --format 16x9");
        expect(c).toContain("render.mjs aLighthouseKeepers          # MP4 with the score");
        expect(c).toContain("gate.mjs aLighthouseKeepers");
      },
    );
  });

  it.concurrent("should redraw the canvas and the brief when another shape is chosen", async () => {
    const page = await viz.given("the builder on 16x9", async () => open(2));

    await viz.when("the visitor picks 9x16", async () =>
      page.click('#iShape .chipbtn[data-v="9x16"]'),
    );

    await viz.then(
      "the canvas is portrait, in the preview, the brief and the say line",
      async () => {
        expect(await preview(page)).toContain("1080 × 1920");
        expect(await brief(page)).toContain("shape:  9x16 (1080x1920)");
        expect(await said(page)).toContain("45 s 9x16 story film");
      },
    );
    await viz.then("only that shape reads as chosen", async () => {
      expect(
        await page.$$eval("#iShape button.chipbtn.on", (b) => b.map((e) => e.dataset["v"])),
      ).toEqual(["9x16"]);
    });
    await viz.then("the commands follow the shape", async () => {
      expect(await commands(page)).toContain("--format 9x16");
    });
  });

  it.concurrent("should recount frames and beats when the frame rate changes", async () => {
    const page = await viz.given("the builder at 30 fps", async () => open(2));

    await viz.when("the visitor picks 24 fps", async () =>
      page.click('#iFps .chipbtn[data-v="24"]'),
    );

    await viz.then(
      "45 s is 1,080 frames, a beat is 12 frames, and the commands carry the rate",
      async () => {
        const p = await preview(page);
        expect(p).toContain("1,080 @ 24 fps");
        expect(p).toContain("12 frames (120 bpm) · 90 beats");
        expect(await commands(page)).toContain("--duration 45 --fps 24");
      },
    );
  });

  it.concurrent("should turn the length slider into seconds, then minutes, and count the frames", async () => {
    const page = await viz.given("the builder", async () => open(2));

    await viz.when("the slider is dragged to its far end", async () => fill(page, "#iLen", "100"));
    await viz.then(
      "the length reads twenty minutes, in the label, the brief and the frame count",
      async () => {
        expect(await text(page, "#iLenV")).toBe("20 m");
        expect(await brief(page)).toContain("length: 20 m");
        expect(await preview(page)).toContain("36,000 @ 30 fps");
      },
    );

    await viz.when("it is dragged to its near end", async () => fill(page, "#iLen", "0"));
    await viz.then("the length reads one second: 30 frames, 2 beats", async () => {
      expect(await text(page, "#iLenV")).toBe("1 s");
      const p = await preview(page);
      expect(p).toContain("30 @ 30 fps");
      expect(p).toContain("15 frames (120 bpm) · 2 beats");
      expect(await commands(page)).toContain("--duration 1 ");
    });

    await viz.when("it is dragged to a point between them", async () => fill(page, "#iLen", "63"));
    await viz.then("the length reads in minutes and seconds", async () => {
      expect(await text(page, "#iLenV")).toBe("1 m 27 s");
      expect(await brief(page)).toContain("length: 1 m 27 s");
    });
  });

  it.concurrent("should turn a still into one frame with no length, beats or render step", async () => {
    const page = await viz.given("the builder on a film", async () => open(2));

    await viz.when("the visitor chooses a Still", async () => page.select("#iKind", "still"));

    await viz.then("the length is one frame and cannot be dragged", async () => {
      expect(await text(page, "#iLenV")).toBe("one frame");
      expect(await page.$eval("#iLen", (e) => e.matches(":disabled"))).toBe(true);
      expect(await brief(page)).toContain("length: one frame");
    });
    await viz.then("the frame maths has one frame and no beats or cuts", async () => {
      const p = await preview(page);
      expect(p).toContain("1 @ 30 fps");
      expect(p).not.toContain("Beat");
      expect(p).not.toContain("Cuts");
    });
    await viz.then(
      "the say line is the still's, and the commands ask for --still with no render or gate",
      async () => {
        expect(await said(page)).toBe(
          "“/anidoodle a 16x9 still of a lighthouse keeper's last night, in woodcut”",
        );
        const c = await commands(page);
        expect(c).toContain("--still aLighthouseKeepers ");
        expect(c).not.toContain("--film");
        expect(c).not.toContain("render.mjs");
        expect(c).not.toContain("gate.mjs");
      },
    );
  });

  it.concurrent("should name the file after the first three words of what the visitor types, or fall back to piece", async () => {
    const page = await viz.given("the builder", async () => open(2));

    await viz.when("the visitor types a subject with punctuation and capitals", async () =>
      fill(page, "#iSubj", "A Tiny, Red Fox! runs home"),
    );
    await viz.then(
      "it appears in the brief and the name is camel-cased from three words",
      async () => {
        expect(await brief(page)).toContain("idea:   A Tiny, Red Fox! runs home");
        expect(await commands(page)).toContain("--film aTinyRed ");
      },
    );

    await viz.when("the visitor clears it", async () => fill(page, "#iSubj", ""));
    await viz.then('the name falls back to "piece"', async () => {
      expect(await commands(page)).toContain("--film piece ");
    });
  });

  it.concurrent("should drop the score from the say line and the render step when the sound is silent", async () => {
    const page = await viz.given("the builder on a story film with a nocturne score", async () =>
      open(2),
    );

    await viz.when("the visitor picks silent", async () => page.select("#iMusic", ""));

    await viz.then(
      'the brief says silent, the say line\'s score is silent, and the render is not "with the score"',
      async () => {
        expect(await brief(page)).toContain("sound:  silent");
        expect(await said(page)).toContain("score: silent");
        const c = await commands(page);
        expect(c).toContain("render.mjs aLighthouseKeepers          # MP4\n");
      },
    );

    await viz.when("the visitor picks another score and mood", async () => {
      await page.select("#iMusic", "jazz");
      await page.select("#iMood", "awe");
    });
    await viz.then("they show together", async () => {
      expect(await brief(page)).toContain("sound:  jazz, awe");
      expect(await said(page)).toContain("score: jazz, awe");
    });
  });

  it.concurrent("should show the chosen style in the brief and the hand-drawn preview", async () => {
    const page = await viz.given("the builder on woodcut", async () => open(2));

    await viz.when("the visitor picks the blueprint style", async () =>
      page.select("#iStyle", "blueprint"),
    );

    await viz.then("the brief, the say line and the preview picture all follow it", async () => {
      expect(await brief(page)).toContain("style:  Cyanotype blueprint (blueprint)");
      expect(await said(page)).toContain("in blueprint,");
      expect(await page.$eval("#shapePreview image", (e) => e.getAttribute("href"))).toBe(
        "media/styles/blueprint.jpg",
      );
      expect(await preview(page)).toContain("Hand");
    });
  });

  it.concurrent("should say each kind of output in its own words, and name its approvals", async () => {
    const page = await viz.given("the builder", async () => open(2));
    const want: [string, string, string][] = [
      [
        "drawing",
        "“/anidoodle a 45 s 16x9 timelapse of a lighthouse keeper's last night drawing itself in woodcut”",
        "1 (the look)",
      ],
      [
        "loop",
        "“/anidoodle a 45 s seamless loop of a lighthouse keeper's last night in woodcut, 16x9”",
        "1 (on the moving file)",
      ],
      [
        "launch",
        "“/anidoodle a 45 s launch video for a lighthouse keeper's last night, woodcut, 16x9, music: nocturne, wistful”",
        "3 (film gates)",
      ],
      [
        "interactive",
        "“/anidoodle an interactive web piece: a lighthouse keeper's last night, in woodcut”",
        "0 ",
      ],
      [
        "lesson",
        "“/anidoodle teach me to draw a lighthouse keeper's last night in woodcut”",
        "1 (a human looks)",
      ],
      [
        "score",
        "“/anidoodle a 45 s score, nocturne, wistful, for a lighthouse keeper's last night”",
        "1 (8 s human listen)",
      ],
    ];

    for (const [kind, sentence, approvals] of want) {
      // oxlint-disable-next-line no-await-in-loop -- one page, one kind at a time
      await viz.when("the visitor picks the kind", async () => page.select("#iKind", kind));
      // oxlint-disable-next-line no-await-in-loop -- reads the kind just picked
      await viz.then("the sentence and the approvals are that kind's", async () => {
        expect(await said(page), kind).toBe(sentence);
        expect(await text(page, "#intakeOut .kv dd:last-child"), kind).toBe(approvals.trim());
      });
    }
  });
});
