export function printRawQuery(query: string, queryParams: Record<string, any>) {
  let debugQuery = query;

  // Replace query parameters in the query string
  for (const [key, value] of Object.entries(queryParams)) {
    if (key === "limit" || key === "offset") {
      const paramRegex = new RegExp(`\\{\\s*${key}\\s*:\\s*Int64\\s*\\}`, "g");
      debugQuery = debugQuery.replace(paramRegex, value);
    } else {
      const paramRegex = new RegExp(
        `\\{\\s*${key}\\s*(?::\\s*.*?)?\\s*\\}`,
        "g"
      );
      const paramValue = Array.isArray(value)
        ? `[${value
            .map((v) =>
              typeof v === "string" ? `'${v.replace(/'/g, "\\'")}'` : v
            )
            .join(", ")}]`
        : typeof value === "string"
        ? `'${value.replace(/'/g, "\\'")}'`
        : value;
      debugQuery = debugQuery.replace(paramRegex, paramValue);
    }
  }

  // Remove extra whitespace and newline characters
  debugQuery = debugQuery.replace(/\s+/g, " ").trim();

  console.log("With Params:");
  console.log(queryParams);
  console.log("Debug Query:");
  console.log(debugQuery);
}
