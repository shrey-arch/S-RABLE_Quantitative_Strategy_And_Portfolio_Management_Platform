import { FlaskConical, Menu } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { SidebarNav } from './Sidebar';

/**
 * Phones and tablets (below the lg breakpoint): a menu button that slides the sidebar in
 * from the left. Closes on Escape, on tapping outside, and after choosing a page.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0">
        <div className="flex h-14 items-center border-b px-5">
          <SheetTitle className="text-lg tracking-tight">S-RABLE</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
        <div className="border-t px-5 py-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FlaskConical aria-hidden className="size-3.5" />
            Historical simulation only
          </span>
        </div>
      </SheetContent>
    </Sheet>
  );
}
