import type { CSSProperties } from "react";

import type { AvatarViseme } from "@/lib/avatar-visemes";

import styles from "./BusinessAvatar.module.css";

export type AvatarMood = "neutral" | "friendly" | "focused" | "confident";
export type AvatarGesture = "rest" | "hand_raise";

export function BusinessAvatar({
  viseme = "rest",
  mood = "neutral",
  gesture = "rest",
  voiceLevel,
  ariaLabel = "Avatar del collega digitale in abito business",
}: {
  viseme?: AvatarViseme;
  mood?: AvatarMood;
  gesture?: AvatarGesture;
  voiceLevel?: number;
  ariaLabel?: string;
}) {
  const avatarStyle = voiceLevel === undefined
    ? undefined
    : ({ "--jaw-open": Math.max(0, Math.min(1, voiceLevel)) } as CSSProperties);

  return (
    <svg
      className={styles.businessAvatar}
      data-viseme={viseme}
      data-mood={mood}
      data-gesture={gesture}
      style={avatarStyle}
      viewBox="0 0 680 760"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id="avatar-suit" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#284a61" /><stop offset="0.46" stopColor="#112838" /><stop offset="1" stopColor="#061119" /></linearGradient>
        <linearGradient id="avatar-lapel" x1="0" x2="0.9" y1="0" y2="1"><stop offset="0" stopColor="#3a5d73" /><stop offset="0.52" stopColor="#193447" /><stop offset="1" stopColor="#091721" /></linearGradient>
        <linearGradient id="avatar-shirt" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#f2eadc" /><stop offset="1" stopColor="#bdb2a0" /></linearGradient>
        <linearGradient id="avatar-tie" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#75b988" /><stop offset="0.48" stopColor="#2f7151" /><stop offset="1" stopColor="#123b29" /></linearGradient>
        <linearGradient id="avatar-tie-shine" x1="0" x2="1"><stop offset="0" stopColor="#d6f3ae" stopOpacity="0" /><stop offset="0.48" stopColor="#d6f3ae" stopOpacity="0.34" /><stop offset="1" stopColor="#d6f3ae" stopOpacity="0" /></linearGradient>
        <radialGradient id="avatar-skin" cx="34%" cy="22%" r="83%"><stop offset="0" stopColor="#f1d6ad" /><stop offset="0.48" stopColor="#c69668" /><stop offset="0.78" stopColor="#a66e4c" /><stop offset="1" stopColor="#70432f" /></radialGradient>
        <linearGradient id="avatar-hand" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#e0af86" /><stop offset="0.56" stopColor="#c58d66" /><stop offset="1" stopColor="#9e654a" /></linearGradient>
        <linearGradient id="avatar-ear" x1="0" x2="1"><stop offset="0" stopColor="#8d5a40" /><stop offset="1" stopColor="#c48c63" /></linearGradient>
        <linearGradient id="avatar-hair" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#6b513d" /><stop offset="0.48" stopColor="#34291f" /><stop offset="1" stopColor="#17130f" /></linearGradient>
        <filter id="avatar-shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="24" stdDeviation="22" floodColor="#000" floodOpacity="0.52" /></filter>
        <filter id="avatar-clay" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.025 0.11" numOctaves="3" seed="12" result="grain" /><feColorMatrix in="grain" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .16 0" result="soft-grain" /><feBlend in="SourceGraphic" in2="soft-grain" mode="soft-light" /></filter>
        <clipPath id="avatar-face-clip"><path d="M209 201c16-90 77-137 135-137 71 0 129 48 141 137l-5 138c-5 89-64 161-139 161-77 0-132-67-139-158l7-141Z" /></clipPath>
        <clipPath id="avatar-tie-clip"><path d="m326 589 29 1 27 129-42 34-42-34 28-130Z" /></clipPath>
      </defs>
      <ellipse className={styles.avatarFloorShadow} cx="340" cy="733" rx="254" ry="24" />
      <g className={styles.avatarBody} filter="url(#avatar-shadow)">
        <path className={styles.suitBack} fill="url(#avatar-suit)" d="M35 756c10-129 60-215 208-249l97 53 98-53c146 34 197 120 207 249H35Z" />
        <path className={styles.shirtFront} fill="url(#avatar-shirt)" d="m244 514 96 47 97-47-26 221H269l-25-221Z" />
        <path className={styles.shirtCollar} fill="url(#avatar-shirt)" d="m244 514 96 47-39 47-47-65-10-29Z" />
        <path className={styles.shirtCollar} fill="url(#avatar-shirt)" d="m437 514-97 47 39 47 48-65 10-29Z" />
        <path className={styles.tieKnot} fill="url(#avatar-tie)" d="m312 559 28-18 29 18-13 37h-31l-13-37Z" />
        <path className={styles.tieBody} fill="url(#avatar-tie)" d="m326 589 29 1 27 129-42 34-42-34 28-130Z" />
        <g clipPath="url(#avatar-tie-clip)"><path className={styles.tieHighlight} fill="url(#avatar-tie-shine)" d="m330 585 14 2 21 151-25 15-10-168Z" /><path className={styles.tieTexture} d="m304 635 67-34m-61 76 67-35m-60 77 62-34" /></g>
        <rect className={styles.tieBar} x="309" y="646" width="62" height="7" rx="3.5" />
        <path className={styles.leftLapel} fill="url(#avatar-lapel)" d="M243 507 77 556l116 180h96l34-139-80-90Z" /><path className={styles.rightLapel} fill="url(#avatar-lapel)" d="m438 507 166 49-116 180h-96l-34-139 80-90Z" />
        <path className={styles.leftLapelEdge} d="m244 513-17 130 77-48" /><path className={styles.rightLapelEdge} d="m437 513 17 130-77-48" /><path className={styles.suitSeam} d="M150 594c-30 42-47 96-53 162m433-162c30 42 47 96 53 162" /><path className={styles.pocket} d="M470 657h94l-9 55h-81l-4-55Z" /><path className={styles.pocketSquare} d="m481 658 19-24 22 18 20-21 14 27h-75Z" /><circle className={styles.lapelPin} cx="476" cy="602" r="7" />
        <g className={styles.raisedHand} aria-hidden="true">
          <path className={styles.raisedSleeve} fill="url(#avatar-suit)" d="M525 550c31 9 57 31 78 60 6-54 2-111-9-170l56 5c11 61 18 122 18 173 0 35-14 64-38 79-23 14-48-2-71-26-21-22-38-42-57-59l23-62Z" />
          <path className={styles.raisedSleeveShade} d="M622 444l28 5c11 61 18 121 18 170 0 34-14 63-38 77-13 8-28 6-41-2 30-24 43-53 39-91-4-50-10-103-16-159Z" />
          <path className={styles.raisedArmSeam} d="M531 565c29 15 54 44 75 79" />
          <path className={styles.raisedCuff} fill="url(#avatar-shirt)" d="m588 449 8-41 58 7-4 43-62-9Z" />
          <path className={styles.raisedPalm} fill="url(#avatar-hand)" d="M573 418c-10-13-16-28-18-43l-18-25c-7-10-3-23 8-25 8-2 14 6 20 17l9 12-5-74c-1-12 10-19 19-13 4 3 5 8 6 15l3 52 1-85c0-13 16-19 23-8 2 4 2 8 2 13v77l6-68c1-12 16-17 23-7 2 4 2 8 2 13l-7 70 7-42c2-11 15-14 21-5 3 4 3 9 2 14-1 39-6 70-17 94-9 20-25 34-44 38-18 4-34-3-43-19Z" />
          <path className={styles.handHighlight} d="M582 288c2 38 4 76 5 112m22-145c0 48-1 96-3 145" />
          <path className={styles.handDetail} d="M623 331c0 25-2 48-5 69m29-61c-3 22-7 42-12 59M564 354c7 6 13 15 17 26" />
        </g>
        <path className={styles.avatarNeck} fill="url(#avatar-skin)" d="M276 424h129l17 106c-42 42-119 42-162 0l16-106Z" /><path className={styles.neckShadow} d="M277 431c15 70 110 85 128 0v59c-29 45-98 45-129 0l1-59Z" />
        <path className={styles.leftEar} fill="url(#avatar-ear)" d="M210 236c-53-25-74 22-48 85 13 31 38 50 67 30l-19-115Z" /><path className={styles.rightEar} fill="url(#avatar-ear)" d="M476 236c53-25 73 22 48 85-13 31-38 50-67 30l19-115Z" /><path className={styles.earDetail} d="M197 268c-27-15-28 42 4 52m286-52c27-15 28 42-4 52" />
        <path className={styles.avatarHead} fill="url(#avatar-skin)" filter="url(#avatar-clay)" d="M209 201c16-90 77-137 135-137 71 0 129 48 141 137l-5 138c-5 89-64 161-139 161-77 0-132-67-139-158l7-141Z" />
        <g clipPath="url(#avatar-face-clip)"><ellipse className={styles.faceLight} cx="283" cy="216" rx="108" ry="166" /><ellipse className={styles.templeShade} cx="459" cy="292" rx="70" ry="174" /><path className={styles.clayStrokeOne} d="M238 153c50-35 145-38 200 3M228 371c48 35 167 35 214-2" /><path className={styles.clayStrokeTwo} d="M245 195c-19 76-12 166 21 231m167-235c19 77 11 167-19 231" /></g>
        <g className={styles.avatarHair} fill="url(#avatar-hair)"><path d="M205 219c-23-84 4-153 76-188 52-26 122-15 165 27 40 39 51 99 36 166l-31-52c-68-3-139-37-166-91-3 57-33 101-80 138Z" /><path d="M249 111c17-61 75-101 139-87-44 13-77 42-98 84l-41 3Z" /><path d="M284 87c32-56 108-72 155-34-55-3-100 17-126 58l-29-24Z" /><path d="M331 77c45-40 115-14 139 35-42-27-90-26-131 2l-8-37Z" /><path d="M391 87c49-12 91 25 96 80-26-35-60-51-101-45l5-35Z" /></g>
        <g className={styles.hairGrooves}><path d="M236 174c17-49 48-91 90-121" /><path d="M286 144c27-50 66-83 115-99" /><path d="M343 141c38-37 79-52 122-42" /><path d="M398 147c37-15 66-7 87 22" /></g>
        <g className={styles.avatarBrows}><path className={styles.leftBrow} d="M244 237c29-18 60-18 89-2" /><path className={styles.rightBrow} d="M374 235c29-15 59-13 85 6" /></g>
        <g className={styles.avatarEyes}><g className={styles.eyesExpression}><path className={styles.eyeWhite} d="M240 273c22-26 66-27 94-2-25 27-69 28-94 2Z" /><path className={styles.eyeWhite} d="M372 272c26-25 69-24 94 2-25 27-69 27-94-2Z" /><g className={styles.pupils}><ellipse className={styles.iris} cx="291" cy="272" rx="17" ry="20" /><ellipse className={styles.iris} cx="416" cy="272" rx="17" ry="20" /><circle cx="291" cy="274" r="8" /><circle cx="416" cy="274" r="8" /><circle className={styles.eyeSpark} cx="285" cy="265" r="4" /><circle className={styles.eyeSpark} cx="410" cy="265" r="4" /></g><path className={styles.upperLid} d="M240 273c22-26 66-27 94-2m38 1c26-25 69-24 94 2" /></g></g>
        <path className={styles.avatarNose} d="M346 273c-3 42-12 73-1 91 10 11 31 10 42 1-13 3-22-2-26-8" /><path className={styles.noseLight} d="M343 292c-2 29-7 48-5 62" /><path className={styles.cheekDetail} d="M235 346c22 18 48 21 73 10m91 0c24 12 49 9 69-9" /><path className={styles.friendlyCheeks} d="M247 364c17 11 35 12 52 4m105 0c17 8 35 6 51-5" />
        <g className={styles.faceExpressions} aria-hidden="true">
          <ellipse className={styles.friendlyBlush} cx="271" cy="354" rx="30" ry="16" />
          <ellipse className={styles.friendlyBlush} cx="430" cy="354" rx="30" ry="16" />
          <path className={styles.focusedBridge} d="M337 238c6-4 13-4 19 0" />
          <path className={styles.focusedEyeLines} d="M253 303c21 8 43 8 63 0m72 0c20 8 42 8 62 0" />
          <path className={styles.confidentEyeLine} d="M386 303c20 7 41 6 59-2" />
        </g>
        <g className={styles.lowerFace}><path className={styles.chinDetail} d="M309 461c21 8 45 8 66 0" /><g className={styles.mouthRig}>
          <g className={`${styles.mouthShape} ${styles.mouthRest}`}><path className={styles.lipUpper} d="M299 407c23-13 62-13 85 0-25 3-60 3-85 0Z" /><path className={styles.lipLower} d="M299 407c25 5 60 5 85 0-15 20-70 20-85 0Z" /><path className={styles.lipLine} d="M301 407c24 4 56 4 81 0" /></g>
          <g className={`${styles.mouthShape} ${styles.mouthMbp}`}><path className={styles.lipUpper} d="M301 406c23-11 58-11 81 0-24 3-57 3-81 0Z" /><path className={styles.lipLower} d="M301 407c24 4 57 4 81 0-14 16-67 16-81 0Z" /><path className={styles.lipLine} d="M303 407c23 2 53 2 77 0" /></g>
          <g className={`${styles.mouthShape} ${styles.mouthFv}`}><path className={styles.mouthCavity} d="M303 404c23-14 54-14 78 0-11 24-67 24-78 0Z" /><path className={styles.teeth} d="M307 404c21-8 48-8 70 0-20 10-50 10-70 0Z" /><path className={styles.lipLower} d="M307 414c20-5 49-5 69 0-18 16-51 16-69 0Z" /></g>
          <g className={`${styles.mouthShape} ${styles.mouthA}`}><path className={styles.mouthCavity} d="M302 402c23-15 55-15 78 0 6 36-11 57-39 57-27 0-45-21-39-57Z" /><path className={styles.teeth} d="M307 402c20-8 48-8 68 0-18 12-50 12-68 0Z" /><path className={styles.tongue} d="M313 443c17-11 40-11 56 0-14 14-43 15-56 0Z" /><path className={styles.lipOutline} d="M302 402c23-15 55-15 78 0 6 36-11 57-39 57-27 0-45-21-39-57Z" /></g>
          <g className={`${styles.mouthShape} ${styles.mouthE}`}><path className={styles.mouthCavity} d="M295 407c27-18 65-18 92 0-22 29-70 29-92 0Z" /><path className={styles.teeth} d="M300 406c24-10 58-10 82 0-22 12-60 12-82 0Z" /><path className={styles.lipOutline} d="M295 407c27-18 65-18 92 0-22 29-70 29-92 0Z" /></g>
          <g className={`${styles.mouthShape} ${styles.mouthO}`}><ellipse className={styles.mouthCavity} cx="341" cy="421" rx="27" ry="34" /><ellipse className={styles.tongue} cx="341" cy="439" rx="15" ry="7" /><ellipse className={styles.lipOutline} cx="341" cy="421" rx="29" ry="36" /></g>
          <g className={`${styles.mouthShape} ${styles.mouthU}`}><ellipse className={styles.mouthCavity} cx="341" cy="418" rx="19" ry="25" /><ellipse className={styles.lipOutline} cx="341" cy="418" rx="24" ry="29" /></g>
          <g className={`${styles.mouthShape} ${styles.mouthConsonant}`}><path className={styles.mouthCavity} d="M302 405c23-15 55-15 78 0-12 25-66 25-78 0Z" /><path className={styles.teeth} d="M307 405c20-8 48-8 68 0-18 9-50 9-68 0Z" /><path className={styles.lipOutline} d="M302 405c23-15 55-15 78 0-12 25-66 25-78 0Z" /></g>
        </g><g className={styles.moodMouthLines} aria-hidden="true"><path className={styles.friendlySmileLines} d="M299 408c-7 0-12-4-15-10m100 10c7 0 12-4 15-10" /><path className={styles.focusedMouthLine} d="M313 432c18 4 37 4 56 0" /><path className={styles.confidentSmileLine} d="M383 408c8-1 13-5 16-12" /></g></g>
      </g>
    </svg>
  );
}
