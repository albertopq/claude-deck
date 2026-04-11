import { NextResponse } from "next/server";
import { queries, type Group } from "@/lib/db";

// GET /api/groups - List all groups
export async function GET() {
  try {
    const groups = await queries.getAllGroups() as Group[];

    // Convert expanded from 0/1 to boolean
    const formattedGroups = groups.map((g) => ({
      ...g,
      expanded: Boolean(g.expanded),
    }));

    return NextResponse.json({ groups: formattedGroups });
  } catch (error) {
    console.error("Error fetching groups:", error);
    return NextResponse.json(
      { error: "Failed to fetch groups" },
      { status: 500 }
    );
  }
}

// POST /api/groups - Create a new group
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, parentPath } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Sanitize name to create path
    const sanitizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!sanitizedName) {
      return NextResponse.json(
        { error: "Invalid group name" },
        { status: 400 }
      );
    }

    // Build full path
    const path = parentPath ? `${parentPath}/${sanitizedName}` : sanitizedName;

    // Check if group already exists
    const existing = await queries.getGroup(path) as Group | undefined;
    if (existing) {
      return NextResponse.json(
        { error: "Group already exists", group: existing },
        { status: 409 }
      );
    }

    // If parent path specified, ensure parent exists
    if (parentPath) {
      const parent = await queries.getGroup(parentPath) as Group | undefined;
      if (!parent) {
        return NextResponse.json(
          { error: "Parent group does not exist" },
          { status: 400 }
        );
      }
    }

    // Get max sort order for new group
    const groups = await queries.getAllGroups() as Group[];
    const maxOrder = groups.reduce((max, g) => Math.max(max, g.sort_order), 0);

    // Create the group
    await queries.createGroup(path, name, maxOrder + 1);

    const newGroup = await queries.getGroup(path) as Group;
    return NextResponse.json(
      {
        group: { ...newGroup, expanded: Boolean(newGroup.expanded) },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating group:", error);
    return NextResponse.json(
      { error: "Failed to create group" },
      { status: 500 }
    );
  }
}
