# oni-vision web dashboard — frontend design notes

Design decisions, explorations, and rationale for the live dashboard at `src/web/index.html`.

---

## Duplicants table

### Column order

```
name  |  focus (boosted priorities)  |  skills (SP + morale cost)  |  stress bar  |  %
```

- **name** — dupe name + any active bad-effect badges (stress vomit, sick, etc.)
- **focus** — chore groups where priority > 3, shown as accent-bar tags
- **skills** — unspent skill points badge + morale cost of mastered skills
- **stress** — inline bar + percentage, sorted descending by default

### What isn't in the save file

- **Morale available** — runtime-computed by the game from decor, food quality, room
  buffs, recreation, etc. Not persisted in `.sav`. We show only morale *cost*
  (sum of tier numbers across mastered skills).
- **Skill points available formula** — derived from `totalExperienceGained` via the
  ONI quadratic XP model: `floor((-1 + sqrt(1 + 8·xp/1000)) / 2) − mastered_count`.
  The n-th skill point costs `n × 1000 XP`; total for n points = `1000·n(n+1)/2`.

---

## Focus tag system

### Explored priority representations (within a domain-colour tag)

| Option | Mechanic | Notes |
|---|---|---|
| Fill intensity | p4 = soft fill, p5 = rich fill + bold | Simple; hierarchy reads as colour weight |
| Border thickness | p4 = 0.5 px, p5 = 1.5 px | Subtle; can be hard to distinguish |
| Shape prefix | p4 = ● dot, p5 = ◆ diamond | Scannable but adds symbol dependency |
| Numeric suffix | Label + `5` or `4` superscript | Most explicit; good for power users |
| Left accent bar | p4 = thin bar, p5 = thick bar + bold | **Chosen** — directional, clean, common in task UIs |
| Trailing pips | 1 dot = p4, 2 dots = p5 | Compact mini-rating; requires learning |

**Decision: left accent bar.**  
`border-left: 2px` for p4, `border-left: 3.5px + font-weight: 500` for p5.  
Tag body is monochrome (neutral fill, system border); all colour lives in the bar.

### Domain colour mapping

Each chore group belongs to one of four domains. The domain determines the bar colour; priority determines bar weight.

| Domain | Bar colour | Chore groups |
|---|---|---|
| Physical | cyan | Digging, Supplying, Building, Tidying, Storing, Life Support |
| Technical | lavender | Researching, Operating, Toggling |
| Social / care | pink | Cooking, Doctoring, Decorating, Farming, Ranching |
| Combat / misc | tangerine | Attacking, Unknown |

---

## Explored palettes

All palettes below use the **monochrome + accent bar** tag structure.  
Body: `var(--color-background-primary)` fill, `var(--color-border-tertiary)` border on three sides.  
The left bar is the only coloured element.

### A — Electric
`#00C896` · `#7B6EF6` · `#FF6B6B` · `#F5A623`  
Strong hues, high energy. Teal pops hard; slightly edgy overall.

### B — Jewel
`#3B82F6` · `#10B981` · `#EC4899` · `#F59E0B`  
Tailwind 500-level classics. Reliable legibility on both light and dark backgrounds.

### C — Neon-lite
`#34D399` · `#818CF8` · `#FB7185` · `#A3E635`  
Brightest option. Lime green is highly distinctive but may clash with the game aesthetic.

### D — Studio ✓ (current)
`#22D3EE` · `#A78BFA` · `#F472B6` · `#FB923C`  
Cyan, lavender, pink, tangerine. Pastel-adjacent but still punchy. Modern and fresh.  
Balanced spread; works well on both dark and light backgrounds.

### E — Contrast
`#38BDF8` · `#4ADE80` · `#F87171` · `#FBBF24`  
Sky, green, red, gold — four corners of the colour wheel. Maximum distinctness,  
fastest to scan. Less personality than other options.

---

## Tag CSS reference (current implementation)

```css
/* Base tag — monochrome body */
.ft {
  font-size: 11px; line-height: 1.7;
  padding: 1px 8px 1px 6px;
  border-radius: 0 4px 4px 0;
  border: 0.5px solid var(--color-border-tertiary);
  background: var(--color-background-primary);
  color: var(--color-text-primary);
}
.ft.p4 { border-left: 2px solid;   }
.ft.p5 { border-left: 3.5px solid; font-weight: 500; }

/* Studio palette — domain bar colours */
.ft-cyan     { border-left-color: #22D3EE; }
.ft-lavender { border-left-color: #A78BFA; }
.ft-pink     { border-left-color: #F472B6; }
.ft-tangerine{ border-left-color: #FB923C; }
```

---

## SP badge

```css
/* Unspent skill points */
.sp-badge        { /* grey, de-emphasised at 0 SP */ }
.sp-badge.has-sp { /* yellow — calls attention when points are waiting */ }
```

Yellow is `var(--hi)` (`#facc15` dark / `#b06000` light), matching the cycle
counter in the page header so the same "golden attention" signal is reused.
