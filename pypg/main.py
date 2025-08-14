import sys


def get_unique_message_rows(log_data: str) -> list[tuple[str, str]]:
    """
    Parses a block of log text to extract unique message types and returns
    the full row of each unique message along with the row below it.

    Args:
        log_data: A string containing the log, where each message is on a new line.

    Returns:
        A list of tuples, where each tuple contains:
        - The full row containing the unique message
        - The row below it (or empty string if it's the last row)
    """
    # Dictionary to store unique message types and their corresponding row data
    unique_messages = {}

    # Split log data into lines
    lines = log_data.strip().split("\n")

    # Iterate over each line with its index
    for i, line in enumerate(lines):
        # Check if the line is not empty and contains a '('
        if line and "(" in line:
            # The message type is the substring before the first '('
            message_type = line.split("(", 1)[0]

            # Only store if we haven't seen this message type before
            if message_type not in unique_messages:
                # Get the next line if it exists, otherwise empty string
                next_line = lines[i + 1] if i + 1 < len(lines) else ""
                unique_messages[message_type] = (line, next_line)

    # Convert to list and sort by message type for consistent output
    return sorted(list(unique_messages.values()))


def main():
    if len(sys.argv) != 2:
        print("Usage: python main.py <text_file_path>")
        sys.exit(1)

    file_path = sys.argv[1]

    try:
        with open(file_path, "r", encoding="utf-8") as file:
            log_data = file.read()

        print(f"Successfully read file: {file_path}")

        unique_message_rows = get_unique_message_rows(log_data)

        print(f"Found {len(unique_message_rows)} unique message types:")
        for i, (message_row, next_row) in enumerate(unique_message_rows, 1):
            print(f"\n{i}. Message row:")
            print(f"   {message_row}")
            if next_row:
                print(f"   Raw Data: {next_row}")
            else:
                print("  (end of file)")

    except FileNotFoundError:
        print(f"File not found: {file_path}")
        sys.exit(1)
    except Exception as e:
        print(f"Error reading file {file_path}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
