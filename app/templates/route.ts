import { permanentTo } from "@/app/_site/redirect";

export function GET() {
  return permanentTo("/#templates");
}
