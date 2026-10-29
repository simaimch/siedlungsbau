import { escapeHTML, MAX_NAME_LENGTH } from "./util";

/**
 * Fragt den Namen für ein neues Gebäude ab.
 * @returns der Name (bei leerer Eingabe der Standardname) oder null bei Abbruch
 */
export async function askBuildingName(defaultName: string): Promise<string | null> {
	const t = (key: string): string => game.i18n.localize(key);
	const result: string | null | undefined = await foundry.applications.api.DialogV2.prompt({
		window: { title: t("SIEDLUNG.nameDialog.title") },
		content:
			`<div class="form-group"><label>${t("SIEDLUNG.nameDialog.label")}</label>` +
			`<div class="form-fields"><input type="text" name="buildingName" value="${escapeHTML(defaultName)}" maxlength="${MAX_NAME_LENGTH}" autofocus></div></div>`,
		ok: {
			label: t("SIEDLUNG.nameDialog.confirm"),
			callback: (_event: Event, button: any): string =>
				(button.form.elements.namedItem("buildingName") as HTMLInputElement).value.trim()
		},
		render: (_event: Event, dialog: any) => {
			const input = dialog.element?.querySelector?.("input[name=buildingName]") as HTMLInputElement | null;
			input?.focus();
			input?.select();
		},
		rejectClose: false
	});
	if (result === null || result === undefined) return null;
	return result || defaultName;
}