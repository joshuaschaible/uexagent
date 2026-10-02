export type ProgressionStep = { path: string; name: string; standing: string; instruction: string; patch: string; groups: ProgressionGroup[] };
export type ProgressionGroup = { path: string; requirement: string; choices: ProgressionStep[] };
export type ProgressionOption = { label: string; root?: ProgressionStep; rows: string[][]; linear: boolean; steps: ProgressionStep[] };

// Reuse the stored response rows so earlier conversations receive the new display too.
export function progressionOptions(rows: string[][]): ProgressionOption[] {
  const options = new Map<string, string[][]>();
  for (const row of rows) {
    const label = row[0]?.split(" / ")[0] || "Unresolved option";
    options.set(label, [...(options.get(label) || []), row]);
  }
  return [...options].map(([label, optionRows]) => {
    const missions = new Map<string, ProgressionStep>();
    const groups = new Map<string, ProgressionGroup>();
    for (const [path, name, standing, instruction, patch] of optionRows) {
      if (name === "Prerequisite group") groups.set(path, { path, requirement: instruction, choices: [] });
      else missions.set(path, { path, name, standing, instruction, patch, groups: [] });
    }
    for (const group of groups.values()) {
      missions.get(group.path.replace(/ \/ group \d+$/, ""))?.groups.push(group);
    }
    for (const mission of missions.values()) {
      if (mission.path !== label) groups.get(mission.path.replace(/ \/ choice \d+(?: variant \d+)?$/, ""))?.choices.push(mission);
    }
    const root = missions.get(label);
    const seen = new Set<string>();
    const steps: ProgressionStep[] = [];
    function collect(step: ProgressionStep): boolean {
      if (seen.has(step.path)) return false;
      seen.add(step.path);
      let linear = step.groups.length <= 1;
      for (const group of step.groups) {
        linear = linear && group.choices.length === 1 && /^Required count: 1(?:;|$)/.test(group.requirement);
        for (const child of group.choices) if (!collect(child)) linear = false;
      }
      steps.push(step);
      return linear;
    }
    const linear = root ? collect(root) : false;
    // A truncated response may have no root or disconnected rows. Keep its raw details visible.
    return { label, root, rows: optionRows, linear: linear && seen.size === missions.size, steps };
  });
}

export function isProgressionTable(headers: string[]) {
  return headers.join("|") === "Path / branch|Mission / requirement|Required standing|How to proceed|Game patch";
}
