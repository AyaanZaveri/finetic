import { getInstalledAddons } from "@/app/actions/auth";
import { AddonsList } from "@/components/addons-list";
import { toAddonListItem } from "@/lib/addons";
import { addonKey } from "@/lib/addon-management";

export const dynamic = "force-dynamic";

export default async function AddonsPage() {
    const addons = await getInstalledAddons();

    return (
        <div className="relative px-[var(--page-gutter)] py-6">
            <div className="relative z-10 flex w-full min-w-0 flex-col gap-6 pb-10">
                <header>
                    <h1 className="font-poppins text-3xl font-medium tracking-tight">Add-ons</h1>
                </header>
                <AddonsList addons={addons.map((addon, index) => ({ ...toAddonListItem(addon, index), id: addonKey(addon.transportUrl) }))} />
            </div>
        </div>
    );
}
