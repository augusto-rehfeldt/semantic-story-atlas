# generate_stories.py
import os
import random

# Story templates with different genres and themes
genres = [
    "Fantasy",
    "Science Fiction",
    "Mystery",
    "Romance",
    "Horror",
    "Adventure",
    "Historical",
    "Thriller",
    "Comedy",
    "Drama",
]

themes = [
    "redemption",
    "love",
    "betrayal",
    "discovery",
    "survival",
    "friendship",
    "revenge",
    "hope",
    "loss",
    "transformation",
]

settings = [
    "a distant galaxy",
    "medieval kingdom",
    "modern city",
    "underwater civilization",
    "post-apocalyptic wasteland",
    "enchanted forest",
    "Victorian London",
    "ancient Egypt",
    "cyberpunk metropolis",
    "remote island",
]

protagonists = [
    "a young orphan",
    "an aging detective",
    "a brilliant scientist",
    "a reluctant hero",
    "a cunning thief",
    "a wise wizard",
    "a brave knight",
    "a mysterious stranger",
    "a gifted artist",
    "a determined explorer",
]

story_templates = [
    """In {setting}, {protagonist} embarks on a journey of {theme}. 
    This {genre} tale weaves through unexpected twists and turns, 
    exploring the depths of human nature and the power of {theme2}.
    As our hero faces insurmountable odds, they discover that true strength 
    lies not in power, but in the connections we forge with others.""",
    """When darkness falls over {setting}, {protagonist} must confront 
    their deepest fears. This gripping {genre} story delves into {theme}, 
    challenging everything our protagonist believes. Through trials of 
    {theme2} and moments of profound revelation, a new path emerges.""",
    """{protagonist} never expected to find themselves in {setting}, 
    yet fate had other plans. This {genre} adventure explores {theme} 
    through vivid characters and breathtaking scenarios. The journey 
    toward {theme2} becomes a testament to the resilience of the spirit.""",
    """Set against the backdrop of {setting}, this {genre} masterpiece 
    follows {protagonist} through a labyrinth of {theme}. Every chapter 
    unveils new mysteries, while the underlying current of {theme2} 
    drives the narrative toward its stunning conclusion.""",
    """In the heart of {setting}, {protagonist} discovers a secret that 
    will change everything. This {genre} story is a meditation on {theme}, 
    wrapped in layers of intrigue and wonder. The pursuit of {theme2} 
    leads to unexpected alliances and earth-shattering revelations.""",
]

titles = [
    "The {adj} {noun}",
    "{noun} of {place}",
    "The Last {noun}",
    "{adj} {noun}: A Tale of {theme}",
    "Beyond the {noun}",
    "Whispers of the {noun}",
    "The {noun}'s {noun2}",
    "Chronicles of {place}",
    "The {adj} Journey",
    "Shadows of {place}",
]

adjectives = [
    "Crimson",
    "Silent",
    "Eternal",
    "Forgotten",
    "Hidden",
    "Sacred",
    "Broken",
    "Golden",
    "Dark",
    "Luminous",
    "Ancient",
    "Mystic",
    "Frozen",
    "Burning",
    "Shattered",
]

nouns = [
    "Crown",
    "Kingdom",
    "Heart",
    "Shadow",
    "Light",
    "Dragon",
    "Phoenix",
    "Storm",
    "Dream",
    "Secret",
    "Throne",
    "Sword",
    "Mirror",
    "Gate",
    "Tower",
]

places = [
    "Avalon",
    "Eldoria",
    "Shadowmere",
    "Crystalia",
    "Ironhold",
    "Starfall",
    "Moonhaven",
    "Thornwood",
    "Serenity",
    "Obsidian",
]


def generate_title():
    template = random.choice(titles)
    return template.format(
        adj=random.choice(adjectives),
        noun=random.choice(nouns),
        noun2=random.choice(nouns),
        place=random.choice(places),
        theme=random.choice(themes).title(),
    )


def generate_story_content():
    template = random.choice(story_templates)
    return template.format(
        setting=random.choice(settings),
        protagonist=random.choice(protagonists),
        genre=random.choice(genres).lower(),
        theme=random.choice(themes),
        theme2=random.choice(themes),
    )


def generate_stories(num_stories=100):
    os.makedirs("stories", exist_ok=True)

    used_titles = set()

    for i in range(num_stories):
        # Generate unique title
        title = generate_title()
        while title in used_titles:
            title = generate_title()
        used_titles.add(title)

        # Generate content
        content = generate_story_content()

        # Add some additional paragraphs for variety
        for _ in range(random.randint(2, 4)):
            content += "\n\n" + generate_story_content()

        # Create filename
        safe_title = "".join(c if c.isalnum() or c in " -_" else "" for c in title)
        safe_title = safe_title.replace(" ", "_")[:50]
        filename = f"stories/{i+1:03d}_{safe_title}.txt"

        # Write file
        with open(filename, "w", encoding="utf-8") as f:
            f.write(f"# {title}\n\n")
            f.write(content)

        print(f"Generated: {filename}")


if __name__ == "__main__":
    generate_stories(100)
    print("\n✅ Generated 100 stories in the 'stories' folder!")
