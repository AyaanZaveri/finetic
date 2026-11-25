import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { User } from "lucide-react";

interface PersonCardProps {
  name: string;
  id?: string;
}

export function PersonCard({ name, id }: PersonCardProps) {
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const content = (
    <div className="group flex flex-col items-center space-y-4 p-4 rounded-2xl hover:bg-accent/50 cursor-pointer max-w-[150px] active:scale-[0.98] transition select-none">
      <Avatar className="size-32 shadow-lg transition-all">
        <AvatarFallback className="bg-muted text-muted-foreground font-semibold text-lg">
          {name ? getInitials(name) : <User className="size-8" />}
        </AvatarFallback>
      </Avatar>

      <div className="text-center space-y-1">
        <h3 className="font-medium text-foreground line-clamp-2 text-sm leading-tight">
          {name || "Unknown person"}
        </h3>
      </div>
    </div>
  );

  if (id) {
    return <Link href={`/person/${id}`} draggable={false}>{content}</Link>;
  }

  return content;
}
