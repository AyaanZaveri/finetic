import { getInstalledAddons } from "@/app/actions/auth";
import { AddonsList } from "@/components/addons-list";
import { toAddonListItem } from "@/lib/addons";
import { addonKey } from "@/lib/addon-management";

export const dynamic = "force-dynamic";

export default async function AddonsPage() {
    const addons = await getInstalledAddons();

    return <AddonsList addons={addons.map((addon, index) => ({ ...toAddonListItem(addon, index), id: addonKey(addon.transportUrl) }))} />;
}
